import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/base-dialog.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import {
  type DfuPackage,
  type DfuProgress,
  flashDfuPackage,
  parseDfuPackage,
  resetToBootloader,
} from "../../util/nrf-dfu.js";
import { isPortPickerCancel } from "../../util/web-serial.js";

import "@home-assistant/webawesome/dist/components/button/button.js";

type InstallState = "idle" | "resetting" | "waiting" | "flashing" | "success" | "error";

/**
 * Two-step nRF52 DFU install dialog:
 * 1. User picks a DFU ZIP and clicks Install → port opened at 1200 baud to
 *    trigger bootloader, then user is asked to click Continue.
 * 2. Continue → port opened at 115200 for actual DFU flashing.
 */
@customElement("esphome-web-install-nrf-dialog")
export class ESPHomeWebInstallNrfDialog extends LitElement {
  @property({ type: Boolean }) open = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _state: InstallState = "idle";
  @state() private _file: File | null = null;
  @state() private _progress: DfuProgress | null = null;
  @state() private _errorMessage = "";

  private _pkg: DfuPackage | null = null;

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("open") && !this.open) {
      this._reset();
    }
  }

  private _reset(): void {
    this._state = "idle";
    this._file = null;
    this._progress = null;
    this._errorMessage = "";
    this._pkg = null;
  }

  private _onFileChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this._file = input.files?.[0] ?? null;
  }

  private async _startInstall(): Promise<void> {
    if (!this._file) {
      this._errorMessage = this._localize("web.nrf.install_error_no_file");
      this._state = "error";
      return;
    }

    const zipBytes = new Uint8Array(await this._file.arrayBuffer());
    try {
      this._pkg = parseDfuPackage(zipBytes);
    } catch (err) {
      this._errorMessage = this._localize("web.nrf.install_error_bad_package", {
        error: err instanceof Error ? err.message : String(err),
      });
      this._state = "error";
      return;
    }

    this._state = "resetting";

    let resetPort: SerialPort;
    try {
      resetPort = await navigator.serial.requestPort();
    } catch (err) {
      if (isPortPickerCancel(err)) {
        this._state = "idle";
        return;
      }
      this._errorMessage = this._localize("web.nrf.install_error_connect", {
        error: err instanceof Error ? err.message : String(err),
      });
      this._state = "error";
      return;
    }

    try {
      await resetToBootloader(resetPort);
    } catch (err) {
      this._errorMessage = this._localize("web.nrf.install_error_connect", {
        error: err instanceof Error ? err.message : String(err),
      });
      this._state = "error";
      return;
    }

    this._state = "waiting";
  }

  private async _continueFlash(): Promise<void> {
    if (!this._pkg) return;

    let flashPort: SerialPort;
    try {
      flashPort = await navigator.serial.requestPort();
    } catch (err) {
      if (isPortPickerCancel(err)) {
        return;
      }
      this._errorMessage = this._localize("web.nrf.install_error_connect", {
        error: err instanceof Error ? err.message : String(err),
      });
      this._state = "error";
      return;
    }

    this._state = "flashing";

    try {
      await flashDfuPackage(flashPort, this._pkg, (p) => {
        this._progress = p;
      });
      this._state = "success";
    } catch (err) {
      this._errorMessage = this._localize("web.nrf.install_error_connect", {
        error: err instanceof Error ? err.message : String(err),
      });
      this._state = "error";
    }
  }

  private _onAfterHide(): void {
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
  }

  private _renderBody() {
    switch (this._state) {
      case "idle":
        return html`
          <p>${this._localize("web.nrf.install_title")}</p>
          <div class="file-row">
            <label class="file-label">
              <span>${this._localize("web.nrf.install_file_label")}</span>
              <input type="file" accept=".zip" @change=${this._onFileChange} />
            </label>
            <span class="file-name">
              ${
                this._file
                  ? this._file.name
                  : this._localize("web.nrf.install_file_placeholder")
              }
            </span>
          </div>
          <div class="actions">
            <wa-button
              variant="brand"
              ?disabled=${!this._file}
              @click=${this._startInstall}
            >
              ${this._localize("web.nrf.install_start")}
            </wa-button>
          </div>
        `;

      case "resetting":
        return html`
          <p>${this._localize("web.nrf.install_flashing")}</p>
          <div class="spinner-row">
            <div class="spinner"></div>
          </div>
        `;

      case "waiting":
        return html`
          <p>${this._localize("web.nrf.install_waiting_hint")}</p>
          <div class="actions">
            <wa-button variant="brand" @click=${this._continueFlash}>
              ${this._localize("web.nrf.install_continue")}
            </wa-button>
          </div>
        `;

      case "flashing": {
        const pct = this._progress ? Math.round(this._progress.percent) : 0;
        const label = this._progress
          ? this._progress.label
          : this._localize("web.nrf.install_flashing");
        return html`
          <p>${label}</p>
          <div class="progress-bar-wrap">
            <div class="progress-bar" style="width: ${pct}%"></div>
          </div>
          <p class="progress-pct">${pct}%</p>
        `;
      }

      case "success":
        return html`
          <p>${this._localize("web.nrf.install_done")}</p>
          <p class="hint">${this._localize("web.nrf.install_done_hint")}</p>
          <div class="actions">
            <wa-button
              variant="brand"
              @click=${() => {
                this._reset();
                this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
              }}
            >
              ${this._localize("command.close")}
            </wa-button>
          </div>
        `;

      case "error":
        return html`
          <p class="error-msg">${this._errorMessage}</p>
          <div class="actions">
            <wa-button variant="neutral" @click=${() => (this._state = "idle")}>
              ${this._localize("command.retry")}
            </wa-button>
          </div>
        `;
    }

    return nothing;
  }

  protected render() {
    return html`
      <esphome-base-dialog
        .label=${this._localize("web.nrf.install_title")}
        ?open=${this.open}
        @after-hide=${this._onAfterHide}
      >
        ${this._renderBody()}
      </esphome-base-dialog>
    `;
  }

  static styles = [
    espHomeStyles,
    css`
      p {
        margin: 0 0 var(--wa-space-s);
        line-height: var(--wa-line-height-normal);
      }
      .hint {
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }
      .error-msg {
        color: var(--esphome-error);
      }
      .file-row {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        margin-bottom: var(--wa-space-m);
      }
      .file-label {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }
      .file-label input[type="file"] {
        font-size: var(--wa-font-size-s);
        font-family: inherit;
      }
      .file-name {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: var(--wa-space-m);
      }
      .spinner-row {
        display: flex;
        justify-content: center;
        padding: var(--wa-space-l) 0;
      }
      .spinner {
        width: 32px;
        height: 32px;
        border: 3px solid var(--wa-color-surface-border);
        border-top-color: var(--esphome-primary);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
      .progress-bar-wrap {
        height: 6px;
        background: var(--wa-color-surface-lowered);
        border-radius: 999px;
        overflow: hidden;
        margin: var(--wa-space-s) 0 var(--wa-space-2xs);
      }
      .progress-bar {
        height: 100%;
        background: var(--esphome-primary);
        border-radius: 999px;
        transition: width 0.2s;
      }
      .progress-pct {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        text-align: right;
        margin: 0;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-nrf-dialog": ESPHomeWebInstallNrfDialog;
  }
}
