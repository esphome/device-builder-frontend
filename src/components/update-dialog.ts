import { consume } from "@lit/context";
import { mdiClose, mdiPlay, mdiStop, mdiRefresh } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "./ansi-log.js";

registerMdiIcons({
  close: mdiClose,
  play: mdiPlay,
  stop: mdiStop,
  refresh: mdiRefresh,
});

type UpdateState = "idle" | "compiling" | "uploading" | "success" | "error";

@customElement("esphome-update-dialog")
export class ESPHomeUpdateDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property()
  configuration = "";

  @property()
  name = "";

  @state()
  private _state: UpdateState = "idle";

  @state()
  private _lines: string[] = [];

  @state()
  private _streamId = "";

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: 680px;
      }

      wa-dialog::part(header) {
        background: var(--esphome-primary);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 0;
        min-width: unset;
        min-height: unset;
        color: var(--esphome-on-primary);
        cursor: pointer;
      }

      wa-dialog::part(body) {
        padding: var(--wa-space-m);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .update-content {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
      }

      /* ─── Status bar ─── */

      .status-bar {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding: var(--wa-space-s) var(--wa-space-m);
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
      }

      .status-bar wa-spinner {
        font-size: 16px;
        --indicator-color: currentColor;
        --track-color: transparent;
      }

      .status-bar--idle {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-quiet);
      }

      .status-bar--compiling,
      .status-bar--uploading {
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        color: var(--esphome-primary);
      }

      .status-bar--success {
        background: color-mix(in srgb, var(--esphome-success), transparent 85%);
        color: var(--esphome-success);
      }

      .status-bar--error {
        background: color-mix(in srgb, var(--esphome-error), transparent 85%);
        color: var(--esphome-error);
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: currentColor;
        flex-shrink: 0;
      }

      /* ─── Log area ─── */

      esphome-ansi-log {
        flex: 1;
      }

      /* ─── Actions ─── */

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
      }

      .dialog-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 8px 18px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: none;
        transition: background 0.12s, opacity 0.12s;
      }

      .dialog-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .dialog-btn wa-icon {
        font-size: 16px;
      }

      .dialog-btn--ghost {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .dialog-btn--ghost:hover:not(:disabled) {
        background: var(--wa-color-surface-border);
      }

      .dialog-btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .dialog-btn--primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .dialog-btn--danger {
        background: var(--esphome-error);
        color: var(--esphome-on-primary);
      }

      .dialog-btn--danger:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-error), black 10%);
      }

      .dialog-btn--success {
        background: var(--esphome-success);
        color: var(--esphome-on-primary);
      }

      .dialog-btn--success:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-success), black 10%);
      }
    `,
  ];

  public open() {
    this._state = "idle";
    this._lines = [];
    this._streamId = "";
    this._dialog.open = true;
  }

  public close() {
    this._stop();
    this._dialog.open = false;
  }

  protected render() {
    const title = this._localize("dashboard.update_title", { name: this.name });

    return html`
      <wa-dialog
        label=${title}
        light-dismiss
        @wa-after-hide=${this._onDialogHide}
      >
        <div class="update-content">
          ${this._renderStatusBar()}
          <esphome-ansi-log
            .lines=${this._lines}
            placeholder=${this._localize("dashboard.update_idle")}
          ></esphome-ansi-log>
          <div class="actions">
            ${this._renderActions()}
          </div>
        </div>
      </wa-dialog>
    `;
  }

  private _renderStatusBar() {
    const stateClass = `status-bar--${this._state}`;
    let label: string;
    let showSpinner = false;

    switch (this._state) {
      case "idle":
        label = this._localize("dashboard.update_idle");
        break;
      case "compiling":
        label = this._localize("dashboard.update_compiling");
        showSpinner = true;
        break;
      case "uploading":
        label = this._localize("dashboard.update_uploading");
        showSpinner = true;
        break;
      case "success":
        label = this._localize("dashboard.update_success");
        break;
      case "error":
        label = this._localize("dashboard.update_failed");
        break;
    }

    return html`
      <div class="status-bar ${stateClass}">
        ${showSpinner
          ? html`<wa-spinner></wa-spinner>`
          : html`<span class="status-dot"></span>`}
        ${label}
      </div>
    `;
  }

  private _renderActions() {
    switch (this._state) {
      case "idle":
        return html`
          <button class="dialog-btn dialog-btn--primary" @click=${this._startUpdate}>
            <wa-icon library="mdi" name="play"></wa-icon>
            ${this._localize("dashboard.update_action")}
          </button>
        `;
      case "compiling":
      case "uploading":
        return html`
          <button class="dialog-btn dialog-btn--danger" @click=${this._stop}>
            <wa-icon library="mdi" name="stop"></wa-icon>
            ${this._localize("dashboard.update_stop")}
          </button>
        `;
      case "success":
        return html`
          <button class="dialog-btn dialog-btn--ghost" @click=${this.close}>
            ${this._localize("dashboard.update_close")}
          </button>
        `;
      case "error":
        return html`
          <button class="dialog-btn dialog-btn--ghost" @click=${this.close}>
            ${this._localize("dashboard.update_close")}
          </button>
          <button class="dialog-btn dialog-btn--primary" @click=${this._startUpdate}>
            <wa-icon library="mdi" name="refresh"></wa-icon>
            ${this._localize("dashboard.update_retry")}
          </button>
        `;
      default:
        return nothing;
    }
  }

  private _startUpdate() {
    this._state = "compiling";
    this._lines = [];

    this._streamId = this._api.compile(this.configuration, {
      onOutput: (line: string) => {
        this._lines = [...this._lines, line];
      },
      onResult: (data: { success: boolean; code: number }) => {
        if (data.success) {
          this._startUpload();
        } else {
          this._state = "error";
          this._lines = [...this._lines, `\x1b[31m${this._localize("dashboard.update_compilation_failed")}\x1b[0m`];
        }
      },
      onError: (error: string) => {
        this._state = "error";
        this._lines = [...this._lines, `\x1b[31mError: ${error}\x1b[0m`];
      },
    });
  }

  private _startUpload() {
    this._state = "uploading";
    this._lines = [...this._lines, "", `\x1b[36m${this._localize("dashboard.update_uploading_header")}\x1b[0m`, ""];

    this._streamId = this._api.upload(this.configuration, "OTA", {
      onOutput: (line: string) => {
        this._lines = [...this._lines, line];
      },
      onResult: (data: { success: boolean; code: number }) => {
        if (data.success) {
          this._state = "success";
          this._lines = [
            ...this._lines,
            "",
            `\x1b[32m${this._localize("dashboard.update_complete_msg")}\x1b[0m`,
          ];
        } else {
          this._state = "error";
          this._lines = [...this._lines, `\x1b[31m${this._localize("dashboard.update_upload_failed")}\x1b[0m`];
        }
      },
      onError: (error: string) => {
        this._state = "error";
        this._lines = [...this._lines, `\x1b[31mError: ${error}\x1b[0m`];
      },
    });
  }

  private _stop() {
    // Stream cancellation is handled by the backend when the WS disconnects
    // or a new command is issued. We just reset the UI state.
    if (this._state === "compiling" || this._state === "uploading") {
      this._state = "error";
      this._lines = [...this._lines, "", `\x1b[33m${this._localize("dashboard.update_stopped")}\x1b[0m`];
    }
    this._streamId = "";
  }

  private _onDialogHide() {
    this._stop();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-update-dialog": ESPHomeUpdateDialog;
  }
}
