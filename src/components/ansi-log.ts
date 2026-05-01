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
 */
const ANSI_ESCAPE_RE =
  /\u001b\[[\x30-\x3f]*[\x20-\x2f]*([\x40-\x7e])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[NOPVWX^_=>]/g;

/** Parse a single log line with ANSI codes into styled spans. */
function parseAnsiLine(line: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  let lastIndex = 0;
  let currentColor: string | undefined;
  let currentBg: string | undefined;
  let bold = false;
  let dim = false;

  let match: RegExpExecArray | null;

  while ((match = ANSI_ESCAPE_RE.exec(line)) !== null) {
    // Push text before this escape
    if (match.index > lastIndex) {
      spans.push({
        text: line.slice(lastIndex, match.index),
        color: currentColor,
        bgColor: currentBg,
        bold,
        dim,
      });
    }

    // Group 1 is the CSI final byte (only set for CSI matches).
    // We only act on SGR (final byte `m`); everything else (cursor
    // moves, erase commands, OSC, single-char escapes) is silently
    // consumed — the bytes between this match and the next one are
    // dropped from the output.
    if (match[1] === "m") {
      // Pull params from inside `ESC [ ... m`. `match[0].slice(2, -1)`
      // is the substring between `ESC[` and `m`.
      const params = match[0].slice(2, -1);
      const codes = params
        .split(";")
        .map((p) => (p === "" ? 0 : Number(p)));
      for (const code of codes) {
        if (code === 0) {
          currentColor = undefined;
          currentBg = undefined;
          bold = false;
          dim = false;
        } else if (code === 1) {
          bold = true;
        } else if (code === 2) {
          dim = true;
        } else if (code === 22) {
          bold = false;
          dim = false;
        } else if (code >= 30 && code <= 37) {
          currentColor = ANSI_COLORS[code];
        } else if (code >= 90 && code <= 97) {
          currentColor = ANSI_COLORS[code];
        } else if (code === 39) {
          currentColor = undefined;
        } else if (code >= 40 && code <= 47) {
          currentBg = ANSI_BG_COLORS[code];
        } else if (code >= 100 && code <= 107) {
          currentBg = ANSI_BG_COLORS[code];
        } else if (code === 49) {
          currentBg = undefined;
        }
      }
    }

    lastIndex = ANSI_ESCAPE_RE.lastIndex;
  }

  // Push remaining text
  if (lastIndex < line.length) {
    spans.push({
      text: line.slice(lastIndex),
      color: currentColor,
      bgColor: currentBg,
      bold,
      dim,
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
    return html`
      <div class="log-container" @scroll=${this._handleScroll}>
        ${visual.length === 0 && this.placeholder
          ? html`<div class="log-line placeholder">${this.placeholder}</div>`
          : visual.map((line) => this._renderLine(line))}
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
   * Strip leading whitespace + ANSI escapes and trailing whitespace
   * from one chunk, preserving the ANSI escapes that sit interior to
   * the visible text. Helps lines line up at the same left offset
   * regardless of how the upstream tool indents.
   */
  private _cleanLine(line: string): string {
    return line
      .replace(
        /^(?:\u001b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[NOPVWX^_=>]|\s)*/g,
        "",
      )
      .replace(/\s+$/, "");
  }

  private _renderLine(line: string) {
    const spans = parseAnsiLine(line);
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
