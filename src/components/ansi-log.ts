/**
 * ANSI log viewer component.
 *
 * Renders log lines with ANSI color codes converted to styled HTML spans.
 * Supports auto-scrolling to the bottom as new lines arrive.
 */
import { consume } from "@lit/context";
import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { IntegrationDoc } from "../api/types/components.js";
import type { LocalizeFunc } from "../common/localize.js";
import { integrationDocsContext, localizeContext } from "../context/index.js";
import { ansiLogThemes } from "../styles/ansi-log/index.js";
import { ANSI_ESCAPE_RE } from "../util/ansi-escapes.js";
import { chunksToVisualLines } from "../util/log-chunks.js";
import {
  type LogDocLink,
  type LogDocLinks,
  resolveLogDocLink,
} from "../util/log-doc-links.js";
import { parseLogLine } from "../util/log-line.js";
import {
  type AnsiSpan,
  docPopoverText,
  logDocLinkStyles,
  renderActionableLine,
  renderComponentLineChildren,
  renderSpanChildren,
  renderSpanChildrenWithTagLink,
} from "./ansi-log-render.js";
import type { ESPHomeLogDocPopover } from "./log-doc-popover.js";

import "./log-doc-popover.js";

/**
 * ANSI 4-bit colour palette as CSS variable references. The
 * concrete values live in ``../styles/ansi-log/{dark,light}.ts``
 * — one file per theme, switched on automatically via the host's
 * ``light`` attribute. Both themes use the same variable names
 * (``--ansi-fg-30`` etc.); only the values differ.
 *
 * Why CSS variables rather than two static records: a theme
 * switch (host gains/loses the ``light`` attribute) re-resolves
 * the variables via the cascade in place, no re-parse of any
 * already-rendered log line. Adding a third theme (Solarized,
 * Dracula, …) is just dropping another sibling file under
 * ``../styles/ansi-log/`` — see that directory's index for the
 * extension contract.
 */
const ANSI_COLORS: Record<number, string> = {
  30: "var(--ansi-fg-30)",
  31: "var(--ansi-fg-31)",
  32: "var(--ansi-fg-32)",
  33: "var(--ansi-fg-33)",
  34: "var(--ansi-fg-34)",
  35: "var(--ansi-fg-35)",
  36: "var(--ansi-fg-36)",
  37: "var(--ansi-fg-37)",
  90: "var(--ansi-fg-90)",
  91: "var(--ansi-fg-91)",
  92: "var(--ansi-fg-92)",
  93: "var(--ansi-fg-93)",
  94: "var(--ansi-fg-94)",
  95: "var(--ansi-fg-95)",
  96: "var(--ansi-fg-96)",
  97: "var(--ansi-fg-97)",
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: "var(--ansi-bg-40)",
  41: "var(--ansi-bg-41)",
  42: "var(--ansi-bg-42)",
  43: "var(--ansi-bg-43)",
  44: "var(--ansi-bg-44)",
  45: "var(--ansi-bg-45)",
  46: "var(--ansi-bg-46)",
  47: "var(--ansi-bg-47)",
  100: "var(--ansi-bg-100)",
  101: "var(--ansi-bg-101)",
  102: "var(--ansi-bg-102)",
  103: "var(--ansi-bg-103)",
  104: "var(--ansi-bg-104)",
  105: "var(--ansi-bg-105)",
  106: "var(--ansi-bg-106)",
  107: "var(--ansi-bg-107)",
};

/**
 * ESPHome log level colors.
 * Applied when a line matches `[timestamp][LEVEL][component:]` but has no ANSI codes.
 * Uses the same theme-aware CSS-variable palette as the ANSI codes.
 */
const LOG_LEVEL_COLORS: Record<string, string> = {
  E: "var(--ansi-fg-31)", // ERROR — red
  W: "var(--ansi-fg-33)", // WARNING — yellow
  I: "var(--ansi-fg-32)", // INFO — green
  C: "var(--ansi-fg-36)", // CONFIG — cyan
  D: "var(--ansi-fg-34)", // DEBUG — blue
  V: "var(--ansi-fg-90)", // VERBOSE — gray
  VV: "var(--log-fg-very-verbose)", // VERY_VERBOSE — dark gray
};

/** Detect ESPHome log level from a line like `[22:40:23.513][C][component:123]: text` */
function detectLogLevelColor(line: string): string | undefined {
  const level = parseLogLine(line)?.level;
  return level ? LOG_LEVEL_COLORS[level] : undefined;
}

/**
 * Mutable SGR state carried *across* ``parseAnsiLine`` calls.
 *
 * ESPHome opens the colour on the first line of a multi-line log
 * record (e.g. a deprecation WARNING with a YAML-shaped suggestion)
 * and only resets it on the last. Resetting per call would leave every
 * continuation line uncoloured, which doesn't match the upstream
 * dashboard. Hand the same object back into each call so colour /
 * bold / dim persist until an explicit reset (``\x1b[0m``).
 */
interface AnsiState {
  color: string | undefined;
  bgColor: string | undefined;
  bold: boolean;
  dim: boolean;
}

// Doc-link cache cap — comfortably above the log dialogs' 5000-line buffer
// so steady-state streaming never prunes; the prune only bounds very long
// sessions whose unique lines churn past the buffer.
const DOC_LINK_CACHE_MAX = 10_000;

function newAnsiState(): AnsiState {
  return { color: undefined, bgColor: undefined, bold: false, dim: false };
}

/** Parse a single log line with ANSI codes into styled spans. */
function parseAnsiLine(line: string, state: AnsiState): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let lastIndex = 0;

  let match: RegExpExecArray | null;

  while ((match = ANSI_ESCAPE_RE.exec(line)) !== null) {
    // Push text before this escape
    if (match.index > lastIndex) {
      spans.push({
        text: line.slice(lastIndex, match.index),
        color: state.color,
        bgColor: state.bgColor,
        bold: state.bold,
        dim: state.dim,
      });
    }

    // Group 1 is the CSI final byte (only set for CSI matches).
    // We only act on SGR (final byte `m`); everything else (cursor
    // moves, erase commands, OSC, single-char escapes) is silently
    // consumed — the bytes between this match and the next one are
    // dropped from the output.
    if (match[1] === "m") {
      // Pull params from inside `<introducer> [ ... m`. The introducer
      // is either the 1-char real `` byte or the 4-char literal
      // `\033` text — slice from after the `[` (not a fixed offset)
      // to the byte before the trailing `m`.
      const params = match[0].slice(match[0].indexOf("[") + 1, -1);
      const codes = params.split(";").map((p) => (p === "" ? 0 : Number(p)));
      for (const code of codes) {
        if (code === 0) {
          state.color = undefined;
          state.bgColor = undefined;
          state.bold = false;
          state.dim = false;
        } else if (code === 1) {
          state.bold = true;
        } else if (code === 2) {
          state.dim = true;
        } else if (code === 22) {
          state.bold = false;
          state.dim = false;
        } else if (code >= 30 && code <= 37) {
          state.color = ANSI_COLORS[code];
        } else if (code >= 90 && code <= 97) {
          state.color = ANSI_COLORS[code];
        } else if (code === 39) {
          state.color = undefined;
        } else if (code >= 40 && code <= 47) {
          state.bgColor = ANSI_BG_COLORS[code];
        } else if (code >= 100 && code <= 107) {
          state.bgColor = ANSI_BG_COLORS[code];
        } else if (code === 49) {
          state.bgColor = undefined;
        }
      }
    }

    lastIndex = ANSI_ESCAPE_RE.lastIndex;
  }

  // Push remaining text
  if (lastIndex < line.length) {
    spans.push({
      text: line.slice(lastIndex),
      color: state.color,
      bgColor: state.bgColor,
      bold: state.bold,
      dim: state.dim,
    });
  }

  return spans;
}

@customElement("esphome-ansi-log")
export class ESPHomeAnsiLog extends LitElement {
  /** Use light theme instead of dark. */
  @property({ type: Boolean, reflect: true })
  light = false;

  /** The log lines to render. */
  @property({ attribute: false })
  lines: string[] = [];

  /** Placeholder text when no lines. */
  @property({ type: String })
  placeholder = "";

  /** Whether to auto-scroll to the bottom. */
  @property({ type: Boolean, attribute: "auto-scroll" })
  autoScroll = true;

  @state()
  private _isUserScrolled = false;

  // Backend component-name → esphome.io docs URL map; drives the per-line
  // component links. Defaults empty when no provider (isolated use / tests).
  @consume({ context: integrationDocsContext, subscribe: true })
  @state()
  private _integrationDocs: Record<string, IntegrationDoc> = {};

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @query(".log-container")
  private _container!: HTMLDivElement;

  @query("esphome-log-doc-popover")
  private _docPopover?: ESPHomeLogDocPopover;

  // Doc-link resolutions keyed by line text. Logs are append-mostly, so
  // insertion order approximates age; when the map outgrows the cap the
  // oldest half is pruned instead of rebuilding it every render (an LRU's
  // per-hit recency bump would double the work for no better retention —
  // each frame touches every visible key anyway). ``null`` = resolved to
  // no links, distinct from "never resolved".
  private _docLinkCache = new Map<string, LogDocLinks | null>();

  static styles = [
    /* Theme-aware ANSI palette + log surface variables. Each theme
       lives in its own sibling file under ../styles/ansi-log/ —
       add `<theme>.ts` + a host-attribute property to extend.
       Dark must come first; light/etc. override its baseline. */
    ...ansiLogThemes,
    css`
      :host {
        display: block;
        height: var(--log-height, 400px);
      }

      .log-container {
        background: var(--log-bg);
        color: var(--log-fg);
        font-family:
          ui-monospace, "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", Menlo,
          Consolas, monospace;
        font-variant-ligatures: none;
        font-size: 12px;
        padding: 8px;
        border-radius: 8px;
        height: 100%;
        overflow-y: auto;
        overflow-x: auto;
        line-height: 18px;
        box-sizing: border-box;
        tab-size: 4;
      }

      /* white-space: pre-wrap lives on the line, not the container. On
       the container Lit's html-template inter-element text nodes
       (whitespace between <div> and the interpolated children) render
       as visible blank lines above the first real log line.

       pre-wrap (vs plain pre) lets long lines wrap at the dialog edge
       instead of forcing the user onto an easily-missed horizontal
       scrollbar — PIO download URLs and full build paths routinely
       run past 200 chars and the install/log dialogs have no obvious
       affordance for sideways scrolling. word-break: break-word +
       overflow-wrap: anywhere is the same belt-and-suspenders pair
       yaml-diff.ts uses — Safari historically honoured the former
       earlier than the latter, so keeping both ensures unbroken
       tokens (URLs, paths) wrap consistently across engines. */
      .log-line {
        margin: 0;
        padding: 0;
        border-radius: 2px;
        line-height: 18px;
        white-space: pre-wrap;
        word-break: break-word;
        overflow-wrap: anywhere;
      }

      .log-line:hover {
        background: var(--log-hover);
      }

      .placeholder {
        color: var(--log-placeholder);
        font-style: italic;
      }

      .bold {
        font-weight: 700;
      }

      .dim {
        opacity: 0.6;
      }
    `,
    logDocLinkStyles,
  ];

  protected willUpdate(changedProperties: Map<string, unknown>) {
    // Resolutions are pure in (line, docs map); a docs-map change is the one
    // input the line-keyed cache can't see, so drop it here.
    if (changedProperties.has("_integrationDocs")) this._docLinkCache.clear();
  }

  protected updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("lines") && this.autoScroll && !this._isUserScrolled) {
      // Sync (not rAF-deferred): ``updated`` runs post-DOM-commit,
      // and a one-frame lag clips the bottom line during bursts.
      this._syncScrollToBottom();
    }
  }

  protected render() {
    const visual = chunksToVisualLines(this.lines);
    // One state object threaded through every line so multi-line
    // records (a WARNING that opens ``\x1b[33m`` on line 1 and only
    // resets on line 5) keep their colour on the continuation lines.
    const state = newAnsiState();
    const rows =
      visual.length === 0 && this.placeholder
        ? html`<div class="log-line placeholder">${this.placeholder}</div>`
        : visual.map((line) => this._renderLine(line, state));
    return html`
      <div class="log-container" @scroll=${this._handleScroll}>${rows}</div>
      <esphome-log-doc-popover></esphome-log-doc-popover>
    `;
  }

  private _renderLine(line: string, state: AnsiState) {
    const spans = parseAnsiLine(line, state);
    const hasAnsiColor = spans.some((s) => s.color || s.bgColor);
    const resolved = this._resolveDocLinkCached(line);
    const component = resolved?.component;

    // Line content first — the two facets are independent, so a curated
    // warning on a catalogued tag gets its tag wrapped AND the icon below.
    let inner: unknown;
    let colorStyle = "";
    if (component && (hasAnsiColor || spans.some((s) => s.bold || s.dim))) {
      // ANSI-styled lines wrap the tag at the span level so per-span
      // colours (and bold/dim) survive.
      inner = renderSpanChildrenWithTagLink(
        spans,
        component,
        this._localize,
        this._openDoc
      );
    } else if (component) {
      const levelColor = resolved?.level && LOG_LEVEL_COLORS[resolved.level];
      colorStyle = levelColor ? `color:${levelColor}` : "";
      inner = renderComponentLineChildren(component, this._localize, this._openDoc);
    } else {
      if (!hasAnsiColor) {
        const levelColor = detectLogLevelColor(line);
        if (levelColor) {
          colorStyle = `color:${levelColor}`;
          inner = line;
        }
      }
      if (inner === undefined) inner = renderSpanChildren(spans);
    }

    if (resolved?.actionable) {
      // The icon inherits the container colour, so give ANSI-styled lines
      // (whose colour lives on inner spans) the level colour there too.
      let containerStyle = colorStyle;
      if (!containerStyle && resolved.level) {
        const levelColor = LOG_LEVEL_COLORS[resolved.level];
        if (levelColor) containerStyle = `color:${levelColor}`;
      }
      return renderActionableLine(
        inner,
        containerStyle,
        resolved.actionable,
        this._localize,
        this._openDoc
      );
    }

    // The ``<div class="log-line">`` opening tag, the children, and the
    // closing ``</div>`` MUST stay on one logical line: ``.log-line`` has
    // ``white-space: pre-wrap`` (preserves runs of newlines and leading
    // spaces in the log text), so inter-tag whitespace from a multi-line
    // template literal renders as a visible blank row + leading-space indent
    // on every log line. Prettier reformatting will silently re-introduce the
    // bug — keep the prettier-ignore directive here.
    /* prettier-ignore */
    return colorStyle
      ? html`<div class="log-line" style=${colorStyle}>${inner}</div>`
      : html`<div class="log-line">${inner}</div>`;
  }

  // Resolve once per unique line; a steady-state cache hit is one Map.get.
  private _resolveDocLinkCached(line: string): LogDocLinks | undefined {
    const cache = this._docLinkCache;
    const hit = cache.get(line);
    if (hit !== undefined) return hit ?? undefined;
    const links = resolveLogDocLink(line, this._integrationDocs) ?? null;
    if (cache.size >= DOC_LINK_CACHE_MAX) {
      // Prune the oldest half (Map iterates in insertion order).
      let drop = cache.size - DOC_LINK_CACHE_MAX / 2;
      for (const key of cache.keys()) {
        if (drop-- <= 0) break;
        cache.delete(key);
      }
    }
    cache.set(line, links);
    return links ?? undefined;
  }

  // Populate the shared popover from the clicked line's link and anchor it to
  // the trigger. stopPropagation so the log-container's own handlers (and the
  // popover's outside-click dismissal) don't treat this as a dismiss.
  private _openDoc = (e: MouseEvent, link: LogDocLink) => {
    e.stopPropagation();
    const pop = this._docPopover;
    const target = e.currentTarget;
    if (!pop || !(target instanceof HTMLElement)) return;
    const text = docPopoverText(link, this._localize);
    pop.heading = text.heading;
    pop.body = text.body;
    pop.url = link.url;
    pop.linkLabel = text.linkLabel;
    void pop.showAt(target);
  };

  private _ignoreNextScroll = false;

  private _handleScroll() {
    if (!this._container) return;
    // ANY scroll — user or streaming auto-scroll — moves lines out from
    // under an open popover; close it before the programmatic early-return
    // so it can't hang fixed over an unrelated line.
    this._docPopover?.hide();
    if (this._ignoreNextScroll) {
      this._ignoreNextScroll = false;
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = this._container;
    this._isUserScrolled = scrollHeight - scrollTop - clientHeight > 40;
  }

  private _syncScrollToBottom() {
    if (!this._container) return;
    this._ignoreNextScroll = true;
    this._container.scrollTop = this._container.scrollHeight;
  }

  private _scrollToBottom() {
    requestAnimationFrame(() => this._syncScrollToBottom());
  }

  /** Public method to scroll to bottom programmatically. */
  scrollToBottom() {
    this._isUserScrolled = false;
    this._scrollToBottom();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-ansi-log": ESPHomeAnsiLog;
  }
}
