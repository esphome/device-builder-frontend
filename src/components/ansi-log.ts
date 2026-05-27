/**
 * ANSI log viewer component.
 *
 * Renders log lines with ANSI color codes converted to styled HTML spans.
 * Supports auto-scrolling to the bottom as new lines arrive.
 */
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { ansiLogThemes } from "../styles/ansi-log/index.js";

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

interface AnsiSpan {
  text: string;
  color?: string;
  bgColor?: string;
  bold?: boolean;
  dim?: boolean;
}

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
  const match = line.match(/^\[[\d:.]+\]\[([EWICDV]V?)\]\[/);
  return match ? LOG_LEVEL_COLORS[match[1]] : undefined;
}

/**
 * Match every ANSI escape sequence we care about as one of three
 * shapes:
 *   - CSI: `ESC [` <params> <intermediate> <final> — group 1 is the
 *     final byte. SGR (`m`) drives colors; everything else (cursor
 *     positioning, erase-line, DECTCEM `?25l/?25h`, ...) we silently
 *     discard so it doesn't leak into the rendered text.
 *   - OSC: `ESC ]` ... terminator — terminal title sets, hyperlinks,
 *     etc. Always discarded.
 *   - Two-char escapes: `ESC` + a single control char. Also discarded.
 * Final-byte / intermediate / parameter ranges follow ECMA-48.
 *
 * The introducer alternation matches BOTH the real `\x1b` byte AND
 * the four-character literal `\033` text that ESPHome's `--dashboard`
 * log formatter emits. ESPHome rewrites `\x1b` to literal `\033` so
 * `colorama` can't strip the codes when stdout is piped to us — without
 * matching the literal form here, the colours would render as plain
 * `\033[32m` text. The original ESPHome dashboard's frontend matches
 * both forms for the same reason.
 */
const ANSI_ESCAPE_RE =
  /(?:\u001b|\\033)\[[\x30-\x3f]*[\x20-\x2f]*([\x40-\x7e])|(?:\u001b|\\033)\][^\u0007\u001b]*(?:\u0007|\u001b\\|\\033\\)|(?:\u001b|\\033)[NOPVWX^_=>]/g;

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

/** Strip leading non-SGR ANSI controls and trailing whitespace. */
export function cleanLine(line: string): string {
  return line
    .replace(
      /^(?:(?:\u001b|\\033)\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x6c\x6e-\x7e]|(?:\u001b|\\033)\][^\u0007\u001b]*(?:\u0007|\u001b\\|\\033\\)|(?:\u001b|\\033)[NOPVWX^_=>])*/g,
      ""
    )
    .replace(/\s+$/, "");
}

/**
 * Fold ``\r``- and ``\n``-terminated output chunks into visual lines.
 *
 * An empty-after-cleaning chunk (PIO's ``\x1b[K\r`` between progress
 * ticks, a bare ``\r``) is a no-op that doesn't toggle the overwrite
 * flag; without that, the next real tick pops a non-progress line
 * above the bar instead of starting fresh (#840).
 */
export function chunksToVisualLines(chunks: string[]): string[] {
  const visual: string[] = [];
  let prevEndedInCR = false;
  for (const chunk of chunks) {
    const text = cleanLine(chunk.replace(/[\r\n]+$/, ""));
    const hasContent = text.replace(ANSI_ESCAPE_RE, "").trim().length > 0;
    if (hasContent) {
      if (prevEndedInCR && chunk !== "\n" && visual.length > 0) {
        visual.pop();
      }
      visual.push(text);
      prevEndedInCR = chunk.endsWith("\r");
    } else if (chunk.endsWith("\n")) {
      prevEndedInCR = false;
    }
  }
  return visual;
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

  @query(".log-container")
  private _container!: HTMLDivElement;

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
        padding: 8px 12px;
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
  ];

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
    return html`
      <div class="log-container" @scroll=${this._handleScroll}>
        ${visual.length === 0 && this.placeholder
          ? html`<div class="log-line placeholder">${this.placeholder}</div>`
          : visual.map((line) => this._renderLine(line, state))}
      </div>
    `;
  }

  private _renderLine(line: string, state: AnsiState) {
    const spans = parseAnsiLine(line, state);
    const hasAnsiColor = spans.some((s) => s.color || s.bgColor);

    // If no ANSI colors, try ESPHome log-level colorization
    if (!hasAnsiColor) {
      const levelColor = detectLogLevelColor(line);
      if (levelColor) {
        return html`<div class="log-line" style="color:${levelColor}">${line}</div>`;
      }
    }

    // The ``<div class="log-line">`` opening tag, the ``${spans.map(...)}``
    // children, and the closing ``</div>`` MUST stay on one logical line:
    // ``.log-line`` has ``white-space: pre-wrap`` (preserves runs of
    // newlines and leading spaces in the log text), so inter-tag
    // whitespace from a multi-line template literal renders as a
    // visible blank row + leading-space indent on every log line.
    // Prettier reformatting will silently re-introduce the bug — keep
    // the prettier-ignore directive here. The same shape applies to
    // the per-span ``<span ...>`` template below.
    /* prettier-ignore */
    const children = spans.map((span) => {
      const style = [
        span.color ? `color:${span.color}` : "",
        span.bgColor ? `background:${span.bgColor}` : "",
      ]
        .filter(Boolean)
        .join(";");
      const classes = [span.bold ? "bold" : "", span.dim ? "dim" : ""]
        .filter(Boolean)
        .join(" ");
      if (style || classes) {
        // prettier-ignore
        return html`<span class=${classes || nothing} style=${style || nothing}>${span.text}</span>`;
      }
      return span.text;
    });
    // prettier-ignore
    return html`<div class="log-line">${children}</div>`;
  }

  private _ignoreNextScroll = false;

  private _handleScroll() {
    if (!this._container) return;
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
