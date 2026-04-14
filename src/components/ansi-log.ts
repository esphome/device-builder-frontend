/**
 * ANSI log viewer component.
 *
 * Renders log lines with ANSI color codes converted to styled HTML spans.
 * Supports auto-scrolling to the bottom as new lines arrive.
 */
import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";

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

/** Parse a single log line with ANSI codes into styled spans. */
function parseAnsiLine(line: string): AnsiSpan[] {
  const spans: AnsiSpan[] = [];
  const regex = /\u001b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let currentColor: string | undefined;
  let currentBg: string | undefined;
  let bold = false;
  let dim = false;

  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
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

    // Parse SGR codes
    const codes = match[1].split(";").map(Number);
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

    lastIndex = regex.lastIndex;
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
      font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code", monospace;
      font-size: 0.8rem;
      padding: 16px;
      border-radius: 8px;
      min-height: 200px;
      max-height: 500px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.5;
    }

    .log-line {
      margin: 0;
      min-height: 1.5em;
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
    if (this.lines.length === 0) {
      return html`
        <div class="log-container">
          ${this.placeholder
            ? html`<div class="log-line placeholder">${this.placeholder}</div>`
            : nothing}
        </div>
      `;
    }

    return html`
      <div class="log-container" @scroll=${this._handleScroll}>
        ${this.lines.map((line) => this._renderLine(line))}
      </div>
    `;
  }

  private _renderLine(line: string) {
    const spans = parseAnsiLine(line);

    if (spans.length === 0) {
      return html`<div class="log-line">&nbsp;</div>`;
    }

    return html`<div class="log-line">
      ${spans.map((span) => {
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
          return html`<span class=${classes || nothing} style=${style || nothing}
            >${span.text}</span
          >`;
        }
        return span.text;
      })}
    </div>`;
  }

  private _handleScroll() {
    if (!this._container) return;
    const { scrollTop, scrollHeight, clientHeight } = this._container;
    // User has scrolled up if not near the bottom
    this._isUserScrolled = scrollHeight - scrollTop - clientHeight > 40;
  }

  private _scrollToBottom() {
    requestAnimationFrame(() => {
      if (this._container) {
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
