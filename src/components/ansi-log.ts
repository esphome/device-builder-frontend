/**
 * ANSI log viewer component.
 *
 * Renders log lines with ANSI color codes converted to styled HTML spans.
 * Supports auto-scrolling to the bottom as new lines arrive.
 */
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

/** ANSI 4-bit color palette (standard 8 + bright 8). */
const ANSI_COLORS: Record<number, string> = {
  30: "#c0c0c0", // default/gray for dark bg
  31: "#f44747", // red
  32: "#6a9955", // green
  33: "#dcdcaa", // yellow
  34: "#569cd6", // blue
  35: "#c586c0", // magenta
  36: "#4ec9b0", // cyan
  37: "#d4d4d4", // white
  90: "#808080", // bright black (gray)
  91: "#f44747", // bright red
  92: "#6a9955", // bright green
  93: "#dcdcaa", // bright yellow
  94: "#569cd6", // bright blue
  95: "#c586c0", // bright magenta
  96: "#4ec9b0", // bright cyan
  97: "#ffffff", // bright white
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: "#1e1e1e",
  41: "#f44747",
  42: "#6a9955",
  43: "#dcdcaa",
  44: "#569cd6",
  45: "#c586c0",
  46: "#4ec9b0",
  47: "#d4d4d4",
  100: "#808080",
  101: "#f44747",
  102: "#6a9955",
  103: "#dcdcaa",
  104: "#569cd6",
  105: "#c586c0",
  106: "#4ec9b0",
  107: "#ffffff",
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
 */
const LOG_LEVEL_COLORS: Record<string, string> = {
  E: "#f44747", // ERROR — red
  W: "#dcdcaa", // WARNING — yellow
  I: "#6a9955", // INFO — green
  C: "#4ec9b0", // CONFIG — cyan
  D: "#569cd6", // DEBUG — blue
  V: "#808080", // VERBOSE — gray
  VV: "#666666", // VERY_VERBOSE — dark gray
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
      const codes = params
        .split(";")
        .map((p) => (p === "" ? 0 : Number(p)));
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

  @query(".log-container")
  private _container!: HTMLDivElement;

  static styles = css`
    :host {
      display: block;
      height: var(--log-height, 400px);
      --log-bg: #1e1e1e;
      --log-fg: #d4d4d4;
      --log-hover: rgba(255, 255, 255, 0.04);
      --log-placeholder: #666;
    }

    :host([light]) {
      --log-bg: #f5f5f5;
      --log-fg: #1e1e1e;
      --log-hover: rgba(0, 0, 0, 0.04);
      --log-placeholder: #999;
    }

    .log-container {
      background: var(--log-bg);
      color: var(--log-fg);
      font-family: ui-monospace, "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", Menlo, Consolas, monospace;
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

    /* white-space: pre lives on the line, not the container. On the
       container Lit's html-template inter-element text nodes
       (whitespace between <div> and the interpolated children) render
       as visible blank lines above the first real log line. */
    .log-line {
      margin: 0;
      padding: 0;
      border-radius: 2px;
      line-height: 18px;
      white-space: pre;
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
  `;

  protected updated(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("lines") && this.autoScroll && !this._isUserScrolled) {
      this._scrollToBottom();
    }
  }

  protected render() {
    const visual = this._chunksToVisualLines(this.lines);
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

  /**
   * Fold an incoming stream of subprocess output chunks into the
   * sequence of "visual" lines we want to render. The backend splits
   * stdout at every `\n` _or_ `\r` and forwards each chunk including
   * its terminator, which means progress updates (esptool's
   * `Writing at 0x10000... (5%)\r`) arrive as CR-terminated chunks.
   * Same rules the old ESPHome dashboard uses:
   *   - A chunk that ends with `\r` "owns" the last visual line; the
   *     next chunk (unless it's a bare `\n`) replaces that line in
   *     place — that's how progress bars overwrite themselves.
   *   - A bare `\n` chunk (the trailing half of a `\r\n` pair)
   *     finalises the line in place — no replacement.
   *   - Everything else is a new line appended to the bottom.
   * Empty visual lines are dropped so stray newlines don't punch
   * blank gaps into the output.
   */
  private _chunksToVisualLines(chunks: string[]): string[] {
    const visual: string[] = [];
    let prevEndedInCR = false;
    for (const chunk of chunks) {
      if (prevEndedInCR && chunk !== "\n" && visual.length > 0) {
        visual.pop();
      }
      const text = this._cleanLine(chunk.replace(/[\r\n]+$/, ""));
      if (text.replace(ANSI_ESCAPE_RE, "").trim().length > 0) {
        visual.push(text);
      }
      prevEndedInCR = chunk.endsWith("\r");
    }
    return visual;
  }

  /**
   * Strip trailing whitespace and any leading non-SGR ANSI control
   * sequences (cursor moves, erase-line, OSC) from one chunk.
   *
   * Leading whitespace AND leading SGR colour codes are intentionally
   * preserved: ESPHome's multi-line WARNING records open the colour
   * on the first line and only reset it on the last, and the
   * continuation lines (``clk:`` / ``  mode: CLK_OUT`` / ``  pin: 0``)
   * use indentation as part of the rendered formatting. Stripping
   * either would left-align continuation lines and drop the colour
   * carry-over.
   */
  private _cleanLine(line: string): string {
    return line
      .replace(
        /^(?:(?:\u001b|\\033)\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x6c\x6e-\x7e]|(?:\u001b|\\033)\][^\u0007\u001b]*(?:\u0007|\u001b\\|\\033\\)|(?:\u001b|\\033)[NOPVWX^_=>])*/g,
        "",
      )
      .replace(/\s+$/, "");
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

    return html`<div class="log-line">${spans.map((span) => {
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
          return html`<span class=${classes || nothing} style=${style || nothing}>${span.text}</span>`;
        }
        return span.text;
      })}</div>`;
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

  private _scrollToBottom() {
    requestAnimationFrame(() => {
      if (this._container) {
        this._ignoreNextScroll = true;
        this._container.scrollTop = this._container.scrollHeight;
      }
    });
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
