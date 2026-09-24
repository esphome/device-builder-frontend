import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/base-dialog.js";
import "../../components/process-terminal/process-terminal.js";
import type { ProcessTerminalState } from "../../components/process-terminal/process-terminal.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { getErrorMessage } from "../../util/error-message.js";
import type { DfuPackage } from "../../util/nrf-dfu.js";
import { requestSerialPort } from "../../util/web-serial.js";

import "@home-assistant/webawesome/dist/components/button/button.js";

type InstallState = "idle" | "resetting" | "waiting" | "flashing" | "success" | "error";

// Loaded on demand so ESP / Pico visitors never download the engine.
const loadDfuEngine = () => import("../../util/nrf-dfu.js");

/**
 * Two-step nRF52 DFU install: 1200-baud reset, then flash over the
 * re-enumerated DFU port. Each requestPort() runs from its own button click
 * (user-gesture requirement).
 */
@customElement("esphome-web-install-nrf-dialog")
export class ESPHomeWebInstallNrfDialog extends LitElement {
  @property({ type: Boolean }) open = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _state: InstallState = "idle";
  @state() private _file: File | null = null;
  // Rounded so per-packet callbacks re-render only on a visible change.
  @state() private _progress = 0;
  @state() private _errorMessage = "";
  // Blocks a second click while a step's file read, engine load or port
  // picker is in flight.
  @state() private _pending = false;
  @state() private _reconnecting = false;

  private _pkg: DfuPackage | null = null;

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("open") && !this.open) {
      this._reset();
    }
  }

  private get _busy(): boolean {
    return this._state === "resetting" || this._state === "flashing";
  }

  private _reset(): void {
    this._state = "idle";
    this._file = null;
    this._progress = 0;
    this._errorMessage = "";
    this._pending = false;
    this._reconnecting = false;
    this._pkg = null;
  }

  private _fail(message: string): void {
    this._errorMessage = message;
    this._state = "error";
  }

  private _onFileChange(e: Event): void {
    const input = e.target as HTMLInputElement;
    this._file = input.files?.[0] ?? null;
  }

  private async _startInstall(): Promise<void> {
    if (!this._file) {
      this._fail(this._localize("web.nrf.install_error_no_file"));
      return;
    }
    if (this._pending) return;
    this._pending = true;
    try {
      await this._prepareAndReset(this._file);
    } finally {
      this._pending = false;
    }
  }

  private async _prepareAndReset(file: File): Promise<void> {
    let resetToBootloader: Awaited<ReturnType<typeof loadDfuEngine>>["resetToBootloader"];
    try {
      // A revoked file handle or a stale chunk after a deploy rejects here.
      const [zipBytes, engine] = await Promise.all([file.arrayBuffer(), loadDfuEngine()]);
      resetToBootloader = engine.resetToBootloader;
      this._pkg = engine.parseDfuPackage(new Uint8Array(zipBytes));
    } catch (err) {
      this._fail(
        this._localize("web.nrf.install_error_bad_package", {
          error: getErrorMessage(err),
        })
      );
      return;
    }

    this._state = "resetting";
    try {
      const port = await requestSerialPort();
      if (!port) {
        this._state = "idle";
        return;
      }
      await resetToBootloader(port);
    } catch (err) {
      this._fail(this._localize("web.connect.failed", { error: getErrorMessage(err) }));
      return;
    }
    this._state = "waiting";
  }

  private async _continueFlash(): Promise<void> {
    const pkg = this._pkg;
    if (!pkg || this._pending) return;

    let port: SerialPort | null;
    this._pending = true;
    try {
      port = await requestSerialPort();
    } catch (err) {
      this._fail(this._localize("web.connect.failed", { error: getErrorMessage(err) }));
      return;
    } finally {
      this._pending = false;
    }
    if (!port) return;

    this._state = "flashing";
    this._progress = 0;
    this._reconnecting = false;
    try {
      const { flashDfuPackageWithReconnect } = await loadDfuEngine();
      await flashDfuPackageWithReconnect(
        port,
        pkg,
        (percent) => {
          this._progress = Math.round(percent);
        },
        { onReconnecting: () => (this._reconnecting = true) }
      );
      this._state = "success";
    } catch (err) {
      this._fail(
        this._localize("web.nrf.install_error_flash", { error: getErrorMessage(err) })
      );
    }
  }

  private _onAfterHide(): void {
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
  }

  private _renderSetup() {
    return html`
      <div class="file-row">
        <label class="file-label">
          <span>${this._localize("web.nrf.install_file_label")}</span>
          <input type="file" accept=".zip" @change=${this._onFileChange} />
        </label>
        <span class="file-name">
          ${this._file ? this._file.name : this._localize("web.nrf.install_file_placeholder")}
        </span>
      </div>
    `;
  }

  private _terminalState(): ProcessTerminalState {
    switch (this._state) {
      case "success":
        return "success";
      case "error":
        return "error";
      case "waiting":
        return null;
      default:
        return "running";
    }
  }

  private _statusMessage(): string {
    switch (this._state) {
      case "resetting":
        return this._localize("web.nrf.install_resetting");
      case "waiting":
        return this._localize("web.nrf.install_waiting_hint");
      case "flashing":
        return this._localize(
          this._reconnecting ? "web.nrf.install_reconnecting" : "web.nrf.install_flashing"
        );
      case "success":
        return this._localize("web.nrf.install_done");
      default:
        return this._localize("firmware.status_failed");
    }
  }

  private _renderProgress() {
    const errored = this._state === "error";
    const done = this._state === "success";
    return html`
      <esphome-process-terminal
        variant="card"
        .state=${this._terminalState()}
        .statusMessage=${this._statusMessage()}
        .statusDetail=${
          errored
            ? this._errorMessage
            : done
              ? this._localize("web.nrf.install_done_hint")
              : ""
        }
        .progress=${this._state === "flashing" ? this._progress : null}
      ></esphome-process-terminal>
    `;
  }

  private _renderAction() {
    switch (this._state) {
      case "idle":
        return html`
          <wa-button
            variant="brand"
            ?disabled=${!this._file || this._pending}
            @click=${this._startInstall}
          >
            ${this._localize("dashboard.install")}
          </wa-button>
        `;
      case "waiting":
        return html`
          <wa-button
            variant="brand"
            ?disabled=${this._pending}
            @click=${this._continueFlash}
          >
            ${this._localize("onboarding.wizard.continue")}
          </wa-button>
        `;
      case "error":
        return html`
          <wa-button variant="neutral" @click=${() => (this._state = "idle")}>
            ${this._localize("command.retry")}
          </wa-button>
        `;
      case "success":
        return html`
          <wa-button variant="brand" @click=${this._onAfterHide}>
            ${this._localize("command.close")}
          </wa-button>
        `;
      default:
        return nothing;
    }
  }

  protected render() {
    return html`
      <esphome-base-dialog
        .label=${this._localize("web.nrf.install_title")}
        ?open=${this.open}
        ?busy=${this._busy}
        @after-hide=${this._onAfterHide}
      >
        ${this._state === "idle" ? this._renderSetup() : this._renderProgress()}
        <div class="actions">${this._renderAction()}</div>
      </esphome-base-dialog>
    `;
  }

  static styles = [
    espHomeStyles,
    css`
      .file-row {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
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
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-nrf-dialog": ESPHomeWebInstallNrfDialog;
  }
}
