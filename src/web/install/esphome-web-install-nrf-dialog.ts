import { consume } from "@lit/context";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/base-dialog.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { getErrorMessage } from "../../util/error-message.js";
import { withManualBootloaderHint } from "../../util/manual-bootloader-hint.js";
import type { DfuPackage } from "../../util/nrf-dfu.js";
import {
  BootloaderTouchError,
  touchIntoBootloader,
} from "../../util/serial-bootloader-touch.js";
import { requestSerialPort } from "../../util/web-serial.js";

import { filePickerStyles, renderFilePicker } from "./file-picker.js";
import {
  installActionsStyles,
  installTerminalState,
  renderCloseButton,
  renderProgressCard,
  renderRetryButton,
} from "./install-progress.js";

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
  @state() private _logLines: string[] = [];

  private _pkg: DfuPackage | null = null;

  private _log = (line: string) => {
    this._logLines = [...this._logLines, line];
  };

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("open") && !this.open) {
      this._reset();
    }
  }

  // Also while a step's file read, engine load or picker is pending: a close
  // then would reset the dialog under a step that keeps running.
  private get _busy(): boolean {
    return this._pending || this._state === "resetting" || this._state === "flashing";
  }

  private _reset(): void {
    this._state = "idle";
    this._file = null;
    this._progress = 0;
    this._errorMessage = "";
    this._pending = false;
    this._reconnecting = false;
    this._logLines = [];
    this._pkg = null;
  }

  private _fail(message: string): void {
    this._errorMessage = message;
    this._state = "error";
  }

  private _onFileChange = (e: Event): void => {
    this._file = (e.target as HTMLInputElement).files?.[0] ?? null;
  };

  private async _startInstall(): Promise<void> {
    if (!this._file) {
      this._fail(this._localize("web.nrf.install_error_no_file"));
      return;
    }
    if (this._pending) return;
    this._pending = true;
    this._logLines = [];
    try {
      await this._prepareAndReset(this._file);
    } finally {
      this._pending = false;
    }
  }

  private async _prepareAndReset(file: File): Promise<void> {
    try {
      // A revoked file handle or a stale chunk after a deploy rejects here.
      const [zipBytes, { parseDfuPackage }] = await Promise.all([
        file.arrayBuffer(),
        loadDfuEngine(),
      ]);
      this._pkg = parseDfuPackage(new Uint8Array(zipBytes));
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
      if (!(await touchIntoBootloader({ onLog: this._log }))) {
        this._state = "idle";
        return;
      }
    } catch (err) {
      // A failed pick has nothing to do with the board; only the touch earns
      // the manual-bootloader hint.
      this._fail(
        this._localize("web.connect.failed", {
          error:
            err instanceof BootloaderTouchError
              ? withManualBootloaderHint(err, this._localize)
              : getErrorMessage(err),
        })
      );
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
      // A cache hit: the engine loaded when the package was parsed.
      const { flashDfuPackageWithReconnect } = await loadDfuEngine();
      await flashDfuPackageWithReconnect(port, pkg, {
        onProgress: (percent) => {
          this._progress = Math.round(percent);
        },
        onReconnecting: () => (this._reconnecting = true),
        onLog: this._log,
      });
      this._state = "success";
    } catch (err) {
      this._fail(
        this._localize("web.nrf.install_error_flash", {
          error: withManualBootloaderHint(err, this._localize),
        })
      );
    }
  }

  private _onAfterHide(): void {
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
  }

  private _renderSetup() {
    return renderFilePicker({
      label: this._localize("web.nrf.install_file_label"),
      accept: ".zip",
      file: this._file,
      placeholder: this._localize("web.nrf.install_file_placeholder"),
      onChange: this._onFileChange,
    });
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
    return renderProgressCard(
      {
        state: installTerminalState(this._state),
        message: this._statusMessage(),
        detail: errored
          ? this._errorMessage
          : done
            ? this._localize("web.nrf.install_done_hint")
            : "",
        progress: this._state === "flashing" ? this._progress : null,
        log: this._logLines,
      },
      this._localize
    );
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
        return renderRetryButton(this._localize, () => (this._state = "idle"));
      case "success":
        return renderCloseButton(this._localize, this._onAfterHide);
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

  static styles = [espHomeStyles, filePickerStyles, installActionsStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-nrf-dialog": ESPHomeWebInstallNrfDialog;
  }
}
