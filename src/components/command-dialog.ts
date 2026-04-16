import { consume } from "@lit/context";
import { mdiClose, mdiPlay, mdiStop, mdiRefresh } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, darkModeContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./ansi-log.js";

registerMdiIcons({
  close: mdiClose,
  play: mdiPlay,
  stop: mdiStop,
  refresh: mdiRefresh,
});

export type CommandType = "update" | "install" | "validate" | "clean";
type CommandState = "running" | "success" | "error";

@customElement("esphome-command-dialog")
export class ESPHomeCommandDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = true;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property()
  configuration = "";

  @property()
  name = "";

  @state()
  private _commandType: CommandType = "validate";

  @state()
  private _state: CommandState | null = null;

  @state()
  private _lines: string[] = [];

  private _streamId = "";

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    css`
      :host {
        --term-bg: #1e1e1e;
        --term-bg-alt: #252526;
        --term-fg: #d4d4d4;
        --term-fg-muted: #808080;
        --term-border: #3c3c3c;
        --term-hover: #2a2d2e;
        --term-accent: #4ec9b0;
        --term-error: #f44747;
        --term-success: #6a9955;
      }

      :host([light]) {
        --term-bg: #f5f5f5;
        --term-bg-alt: #e8e8e8;
        --term-fg: #1e1e1e;
        --term-fg-muted: #6e6e6e;
        --term-border: #d0d0d0;
        --term-hover: #dcdcdc;
        --term-accent: #0d8a6f;
        --term-error: #c02020;
        --term-success: #3d7a28;
      }

      wa-dialog {
        --width: 720px;
      }

      wa-dialog::part(header) {
        background: var(--term-bg);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      wa-dialog::part(title) {
        color: var(--term-accent);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: "SF Mono", "Fira Code", "Fira Mono", "Cascadia Code",
          monospace;
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 0;
        min-width: unset;
        min-height: unset;
        color: var(--term-fg-muted);
        cursor: pointer;
      }

      wa-dialog::part(body) {
        padding: 0;
        background: var(--term-bg);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .content {
        display: flex;
        flex-direction: column;
      }

      esphome-ansi-log::part(container) {
        border-radius: 0;
      }

      .terminal-toolbar {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        padding: 6px var(--wa-space-m);
        background: var(--term-bg-alt);
        border-top: 1px solid var(--term-border);
      }

      .terminal-toolbar .spacer {
        flex: 1;
      }

      .status-label {
        font-size: 12px;
        font-weight: 600;
        font-family: "SF Mono", "Fira Code", monospace;
        color: var(--term-fg-muted);
      }

      .status-label--success {
        color: var(--term-success);
      }

      .status-label--error {
        color: var(--term-error);
      }

      .streaming-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--term-accent);
        animation: pulse 1.5s infinite;
      }

      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.3;
        }
      }

      .term-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        padding: 4px 12px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 600;
        font-family: "SF Mono", "Fira Code", monospace;
        cursor: pointer;
        border: 1px solid var(--term-border);
        transition: background 0.1s, border-color 0.1s;
      }

      .term-btn wa-icon {
        font-size: 14px;
      }

      .term-btn--ghost {
        background: transparent;
        color: var(--term-fg-muted);
      }

      .term-btn--ghost:hover {
        background: var(--term-hover);
        color: var(--term-fg);
        border-color: var(--term-fg-muted);
      }

      .term-btn--stop {
        background: color-mix(in srgb, var(--term-error), transparent 85%);
        color: var(--term-error);
        border-color: color-mix(in srgb, var(--term-error), transparent 60%);
      }

      .term-btn--stop:hover {
        background: color-mix(in srgb, var(--term-error), transparent 75%);
      }

      .term-btn--start {
        background: color-mix(in srgb, var(--term-accent), transparent 85%);
        color: var(--term-accent);
        border-color: color-mix(in srgb, var(--term-accent), transparent 60%);
      }

      .term-btn--start:hover {
        background: color-mix(in srgb, var(--term-accent), transparent 75%);
      }
    `,
  ];

  protected willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("_darkMode")) {
      this.toggleAttribute("light", !this._darkMode);
    }
  }

  public open(type: CommandType) {
    this._commandType = type;
    this._state = null;
    this._lines = [];
    this._streamId = "";
    this._dialog.open = true;
    this._start();
  }

  public close() {
    this._stop();
    this._dialog.open = false;
  }

  private get _title(): string {
    return this._localize(`command.${this._commandType}_title`, {
      name: this.name,
    });
  }

  protected render() {
    return html`
      <wa-dialog
        label=${this._title}
        light-dismiss
        @wa-after-hide=${this._onDialogHide}
      >
        <div class="content">
          <esphome-ansi-log
            .lines=${this._lines}
            ?light=${!this._darkMode}
          ></esphome-ansi-log>
          ${this._renderToolbar()}
        </div>
      </wa-dialog>
    `;
  }

  private _renderToolbar() {
    return html`
      <div class="terminal-toolbar">
        ${this._renderStatus()}
        <span class="spacer"></span>
        ${this._renderActions()}
      </div>
    `;
  }

  private _renderStatus() {
    switch (this._state) {
      case "running":
        return html`<span class="streaming-dot"></span>`;
      case "success":
        return html`<span class="status-label status-label--success">
          ${this._localize("command.done")}
        </span>`;
      case "error":
        return html`<span class="status-label status-label--error">
          ${this._localize("command.failed")}
        </span>`;
      default:
        return nothing;
    }
  }

  private _renderActions() {
    switch (this._state) {
      case "running":
        return html`
          <button class="term-btn term-btn--stop" @click=${this._stop}>
            <wa-icon library="mdi" name="stop"></wa-icon>
            ${this._localize("command.stop")}
          </button>
        `;
      case "error":
        return html`
          <button class="term-btn term-btn--start" @click=${this._start}>
            <wa-icon library="mdi" name="refresh"></wa-icon>
            ${this._localize("command.retry")}
          </button>
          <button class="term-btn term-btn--ghost" @click=${this.close}>
            ${this._localize("command.close")}
          </button>
        `;
      case "success":
        return html`
          <button class="term-btn term-btn--ghost" @click=${this.close}>
            ${this._localize("command.close")}
          </button>
        `;
      default:
        return nothing;
    }
  }

  // ─── Command execution ─────────────────────────────────────

  private _start() {
    this._state = "running";
    this._lines = [];

    switch (this._commandType) {
      case "update":
      case "install":
        this._runCompileUpload();
        break;
      case "validate":
        this._runSingleCommand("validate");
        break;
      case "clean":
        this._runSingleCommand("clean");
        break;
    }
  }

  private _runSingleCommand(command: "validate" | "clean") {
    this._streamId = this._api[command](this.configuration, {
      onOutput: (line: string) => {
        this._lines = [...this._lines, line];
      },
      onResult: (data: { success: boolean }) => {
        this._streamId = "";
        if (data.success) {
          this._state = "success";
          this._lines = [
            ...this._lines,
            "",
            `\x1b[32m${this._localize(`command.${command}_success`)}\x1b[0m`,
          ];
        } else {
          this._state = "error";
          this._lines = [
            ...this._lines,
            "",
            `\x1b[31m${this._localize(`command.${command}_failed`)}\x1b[0m`,
          ];
        }
      },
      onError: (error: string) => {
        this._streamId = "";
        this._state = "error";
        this._lines = [
          ...this._lines,
          `\x1b[31mError: ${error}\x1b[0m`,
        ];
      },
    });
  }

  private _runCompileUpload() {
    this._lines = [
      `\x1b[36m── ${this._localize("command.compiling")} ──\x1b[0m`,
      "",
    ];

    this._streamId = this._api.compile(this.configuration, {
      onOutput: (line: string) => {
        this._lines = [...this._lines, line];
      },
      onResult: (data: { success: boolean }) => {
        if (data.success) {
          this._runUpload();
        } else {
          this._streamId = "";
          this._state = "error";
          this._lines = [
            ...this._lines,
            "",
            `\x1b[31m${this._localize("command.compile_failed")}\x1b[0m`,
          ];
        }
      },
      onError: (error: string) => {
        this._streamId = "";
        this._state = "error";
        this._lines = [
          ...this._lines,
          `\x1b[31mError: ${error}\x1b[0m`,
        ];
      },
    });
  }

  private _runUpload() {
    this._lines = [
      ...this._lines,
      "",
      `\x1b[36m── ${this._localize("command.uploading")} ──\x1b[0m`,
      "",
    ];

    this._streamId = this._api.upload(this.configuration, "OTA", {
      onOutput: (line: string) => {
        this._lines = [...this._lines, line];
      },
      onResult: (data: { success: boolean }) => {
        this._streamId = "";
        if (data.success) {
          this._state = "success";
          this._lines = [
            ...this._lines,
            "",
            `\x1b[32m${this._localize("command.upload_success")}\x1b[0m`,
          ];
        } else {
          this._state = "error";
          this._lines = [
            ...this._lines,
            "",
            `\x1b[31m${this._localize("command.upload_failed")}\x1b[0m`,
          ];
        }
      },
      onError: (error: string) => {
        this._streamId = "";
        this._state = "error";
        this._lines = [
          ...this._lines,
          `\x1b[31mError: ${error}\x1b[0m`,
        ];
      },
    });
  }

  private _stop() {
    if (this._state === "running") {
      this._state = "error";
      this._lines = [
        ...this._lines,
        "",
        `\x1b[33m${this._localize("command.stopped")}\x1b[0m`,
      ];
    }
    this._streamId = "";
  }

  private _onDialogHide() {
    this._stop();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-command-dialog": ESPHomeCommandDialog;
  }
}
