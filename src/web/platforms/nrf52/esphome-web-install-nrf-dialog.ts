import { consume } from "@lit/context";
import { html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../../common/localize.js";
import "../../../components/base-dialog.js";
import { localizeContext } from "../../../context/index.js";
import {
  type DfuPackage,
  loadDfuEngine,
  loadDfuPackage,
  withManualBootloaderHint,
} from "../../../platforms/nrf52/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { getErrorMessage } from "../../../util/error-message.js";
import {
  BootloaderTouchError,
  touchIntoBootloader,
} from "../../../util/serial-bootloader-touch.js";
import { requestSerialPort } from "../../../util/web-serial.js";

import {
  type FilePickerError,
  filePickerStyles,
  renderFilePicker,
} from "../../install/file-picker.js";
import {
  installActionsStyles,
  installTerminalState,
  renderCloseButton,
  renderProgressCard,
  renderRetryButton,
} from "../../install/install-progress.js";

import {
  parseFailureCopy,
  Preparation,
  type Prepared,
} from "../../install/preparation.js";

import "@home-assistant/webawesome/dist/components/button/button.js";

type InstallState = "idle" | "resetting" | "waiting" | "flashing" | "success" | "error";

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
  // Blocks a second click while the flash step's port picker is open.
  @state() private _pending = false;
  // Why the picked file cannot be installed, shown under the picker.
  @state() private _fileError: FilePickerError | null = null;

  @query("input[type=file]") private _fileInput?: HTMLInputElement;
  @state() private _reconnecting = false;
  @state() private _logLines: string[] = [];

  // The package is read and parsed when it is picked, so the click that
  // starts the install goes straight to the port picker.
  private _package = new Preparation<File, DfuPackage, FilePickerError>(
    this,
    (file) => this._parse(file),
    (failure) => this._onPrepared(failure),
    // A revoked file handle rejects the read.
    (err) => ({
      title: this._localize("firmware.nrf_bad_package"),
      detail: getErrorMessage(err),
    })
  );

  private async _parse(file: File): Promise<Prepared<DfuPackage, FilePickerError>> {
    const bytes = await file.arrayBuffer();
    const parsed = await loadDfuPackage(new Uint8Array(bytes));
    if ("pkg" in parsed) return { value: parsed.pkg };
    const { key, retryable } = parseFailureCopy(parsed.key);
    return { failure: { title: this._localize(key), detail: parsed.detail }, retryable };
  }

  private _onPrepared(failure: FilePickerError | null): void {
    this._fileError = failure;
    if (this._package.state.kind === "idle") this._unpick();
  }

  // The input is emptied with the file: it fires no change for the file it
  // still holds, so that file could not be picked a second time.
  private _unpick(): void {
    this._file = null;
    if (this._fileInput) this._fileInput.value = "";
  }

  private _log = (line: string) => {
    this._logLines = [...this._logLines, line];
  };

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("open") && !this.open) {
      this._reset();
    }
  }

  // Also while a step's picker is open: a close then would reset the dialog
  // under a step that keeps running.
  private get _busy(): boolean {
    return this._pending || this._state === "resetting" || this._state === "flashing";
  }

  private _reset(): void {
    this._state = "idle";
    this._unpick();
    this._fileError = null;
    this._package.clear();
    this._progress = 0;
    this._errorMessage = "";
    this._pending = false;
    this._reconnecting = false;
    this._logLines = [];
  }

  private _fail(message: string): void {
    this._errorMessage = message;
    this._state = "error";
  }

  private _onFileChange = (e: Event): void => {
    this._file = (e.target as HTMLInputElement).files?.[0] ?? null;
    this._fileError = null;
    if (this._file) this._package.start(this._file);
    else this._package.clear();
  };

  // The engine did not load for the picked file: load it again.
  private _retryFile = (): void => {
    this._fileError = null;
    this._package.retry();
  };

  private async _startInstall(): Promise<void> {
    if (this._package.state.kind !== "ready" || this._state !== "idle") return;
    this._logLines = [];
    this._state = "resetting";
    try {
      // Nothing is awaited before the touch's port picker: it needs the
      // click's activation.
      const touched = await touchIntoBootloader({ onLog: this._log });
      this._state = touched ? "waiting" : "idle";
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
    }
  }

  private async _continueFlash(): Promise<void> {
    const prepared = this._package.state;
    if (prepared.kind !== "ready" || this._pending) return;
    const pkg = prepared.value;

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
      preparing:
        this._package.state.kind === "pending"
          ? this._localize("web.install.preparing")
          : undefined,
      error: this._fileError,
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
        if (this._package.state.kind === "retryable") {
          return renderRetryButton(this._localize, this._retryFile);
        }
        return html`
          <wa-button
            variant="brand"
            ?disabled=${this._package.state.kind !== "ready"}
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
