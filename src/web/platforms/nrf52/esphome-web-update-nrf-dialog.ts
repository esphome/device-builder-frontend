import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../../common/localize.js";
import "../../../components/base-dialog.js";
import { localizeContext } from "../../../context/index.js";
import {
  isWebBluetoothSupported,
  loadMcubootImage,
  loadSmpEngine,
  type McubootImage,
  pickBleDevice,
  SMP_BLE_SERVICE_UUID,
  type SmpUploadHooks,
} from "../../../platforms/nrf52/index.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { getErrorMessage } from "../../../util/error-message.js";
import { openFailureMessage } from "../../../util/serial-open-error.js";
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

// "restart": the image is on the device, which could not be restarted.
type UpdateState = "idle" | "flashing" | "success" | "error" | "restart";
type SmpEngine = Awaited<ReturnType<typeof loadSmpEngine>>;

/**
 * nRF52 MCUboot update over the mcumgr SMP service the running firmware
 * exposes, by Bluetooth or serial. One step: the device chooser runs from
 * the button's click (user-gesture requirement), then the image is sent.
 */
@customElement("esphome-web-update-nrf-dialog")
export class ESPHomeWebUpdateNrfDialog extends LitElement {
  @property({ type: Boolean }) open = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _state: UpdateState = "idle";
  @state() private _file: File | null = null;
  // Rounded so per-chunk callbacks re-render only on a visible change.
  @state() private _progress = 0;
  @state() private _errorMessage = "";
  // Blocks a second click while a device chooser is open.
  @state() private _pending = false;
  // Why the picked file cannot be installed, shown under the picker.
  @state() private _fileError: FilePickerError | null = null;
  @state() private _logLines: string[] = [];

  @query("input[type=file]") private _fileInput?: HTMLInputElement;

  private _abort: AbortController | null = null;

  // The image is read and checked when it is picked, so the click that
  // starts the update goes straight to the device chooser.
  private _image = new Preparation<File, McubootImage, FilePickerError>(
    this,
    (file) => this._parse(file),
    (failure) => this._onPrepared(failure),
    // A revoked file handle rejects the read.
    (err) => ({
      title: this._localize("firmware.nrf_bad_mcuboot_image"),
      detail: getErrorMessage(err),
    })
  );

  private async _parse(file: File): Promise<Prepared<McubootImage, FilePickerError>> {
    const bytes = await file.arrayBuffer();
    const parsed = await loadMcubootImage(new Uint8Array(bytes));
    if ("image" in parsed) return { value: parsed.image };
    const { key, retryable } = parseFailureCopy(parsed.key);
    return { failure: { title: this._localize(key), detail: parsed.detail }, retryable };
  }

  private _onPrepared(failure: FilePickerError | null): void {
    this._fileError = failure;
    if (this._image.state.kind === "idle") this._unpick();
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

  // Also while a chooser is open: a close then would reset the dialog under
  // an update that keeps running.
  private get _busy(): boolean {
    return this._pending || this._state === "flashing";
  }

  private _reset(): void {
    this._abort?.abort(new Error("closed"));
    this._abort = null;
    this._state = "idle";
    this._unpick();
    this._fileError = null;
    this._image.clear();
    this._progress = 0;
    this._errorMessage = "";
    this._pending = false;
    this._logLines = [];
  }

  private _onFileChange = (e: Event): void => {
    this._file = (e.target as HTMLInputElement).files?.[0] ?? null;
    this._fileError = null;
    if (this._file) this._image.start(this._file);
    else this._image.clear();
  };

  // The engine did not load for the picked file: load it again.
  private _retryFile = (): void => {
    this._fileError = null;
    this._image.retry();
  };

  private _updateOverBle = (): Promise<void> =>
    this._update(
      // The failures of the chooser are toasted by the picker itself.
      () =>
        pickBleDevice(this._localize, [], SMP_BLE_SERVICE_UUID, [SMP_BLE_SERVICE_UUID]),
      (engine, device, image, hooks) => engine.flashMcubootOverBle(device, image, hooks)
    );

  private _updateOverSerial = (): Promise<void> =>
    this._update(
      async () => {
        try {
          return await requestSerialPort();
        } catch (err) {
          // Not on a dialog closed under the chooser: it would reopen failed.
          if (this.open) {
            this._fail(openFailureMessage(err, this._localize, "web.connect.failed"));
          }
          return null;
        }
      },
      (engine, port, image, hooks) => engine.flashMcubootOverSerial(port, image, hooks),
      // Not over Bluetooth, where the service found says the transport is there.
      "web.nrf.update_serial_no_reply"
    );

  /**
   * ``pick`` opens the chooser (null when there is nothing to update),
   * ``flash`` runs the engine over what it picked, ``silentKey`` is the line
   * for a device that never answered.
   */
  private async _update<Target>(
    pick: () => Promise<Target | null>,
    flash: (
      engine: SmpEngine,
      target: Target,
      image: McubootImage,
      hooks: SmpUploadHooks
    ) => Promise<void>,
    silentKey?: string
  ): Promise<void> {
    const prepared = this._image.state;
    if (prepared.kind !== "ready" || this._state !== "idle" || this._pending) return;
    this._pending = true;
    let target: Target | null;
    try {
      // Nothing is awaited before the chooser: it needs the click's activation.
      target = await pick();
    } finally {
      this._pending = false;
    }
    // A dialog closed under the chooser dropped the image it was opened for.
    if (target === null || this._state !== "idle" || this._image.state !== prepared) {
      return;
    }

    this._logLines = [];
    this._progress = 0;
    this._state = "flashing";
    const abort = new AbortController();
    this._abort = abort;
    let engine: SmpEngine | undefined;
    try {
      // A cache hit: the engine loaded when the image was parsed.
      engine = await loadSmpEngine();
      // Closed while the engine loaded: the device is not to be touched.
      if (abort.signal.aborted) return;
      await flash(engine, target, prepared.value, {
        signal: abort.signal,
        onProgress: (percent) => {
          this._progress = Math.round(percent);
        },
        onLog: this._log,
      });
      if (!abort.signal.aborted) this._state = "success";
    } catch (err) {
      if (abort.signal.aborted) return;
      console.error("[nrf52] The MCUboot update failed:", err);
      if (engine && err instanceof engine.SmpRestartNeededError) this._state = "restart";
      else this._fail(this._failureOf(engine, err, silentKey));
    } finally {
      if (this._abort === abort) this._abort = null;
    }
  }

  // The site cannot know what the device runs, so a device without the
  // mcumgr service is named as such.
  private _failureOf(
    engine: SmpEngine | undefined,
    err: unknown,
    silentKey?: string
  ): string {
    if (!engine) return this._localize("web.install.tools_load_failed");
    if (err instanceof engine.SmpBleServiceNotFoundError) {
      return this._localize("firmware.nrf_smp_ble_service_not_found");
    }
    if (engine.isSerialDeviceLost(err)) return this._localize("serial.device_lost");
    // Only a device that never answered: one that stopped part way has the
    // transport.
    if (silentKey && err instanceof engine.SmpSilentDeviceError) {
      return this._localize(silentKey);
    }
    return this._localize("web.nrf.install_error_flash", {
      error: getErrorMessage(err),
    });
  }

  private _fail(message: string): void {
    this._errorMessage = message;
    this._state = "error";
  }

  private _onAfterHide(): void {
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
  }

  private _renderSetup() {
    return html`
      <p class="hint">${this._localize("web.nrf.update_hint")}</p>
      ${renderFilePicker({
        label: this._localize("web.nrf.update_file_label"),
        accept: ".bin,.img",
        file: this._file,
        placeholder: this._localize("web.nrf.install_file_placeholder"),
        onChange: this._onFileChange,
        preparing:
          this._image.state.kind === "pending"
            ? this._localize("web.install.preparing")
            : undefined,
        error: this._fileError,
      })}
    `;
  }

  private _statusMessage(): string {
    switch (this._state) {
      case "flashing":
        return this._localize("web.nrf.install_flashing");
      case "success":
        return this._localize("web.nrf.install_done");
      case "restart":
        return this._localize("firmware.nrf_smp_restart_needed_title");
      default:
        return this._localize("firmware.status_failed");
    }
  }

  private _renderProgress() {
    return renderProgressCard(
      {
        // The card has no banner for it; the error one says it needs attention.
        state: installTerminalState(this._state === "restart" ? "error" : this._state),
        message: this._statusMessage(),
        detail:
          this._state === "error"
            ? this._errorMessage
            : this._state === "success"
              ? this._localize("web.nrf.install_done_hint")
              : this._state === "restart"
                ? this._localize("firmware.nrf_smp_restart_needed")
                : "",
        progress: this._state === "flashing" ? this._progress : null,
        log: this._logLines,
      },
      this._localize
    );
  }

  private _renderAction() {
    switch (this._state) {
      case "idle": {
        if (this._image.state.kind === "retryable") {
          return renderRetryButton(this._localize, this._retryFile);
        }
        const disabled = this._image.state.kind !== "ready" || this._pending;
        return html`
          <wa-button
            id="btn-update-serial"
            variant="neutral"
            ?disabled=${disabled}
            @click=${this._updateOverSerial}
          >
            ${this._localize("web.nrf.update_serial")}
          </wa-button>
          ${
            isWebBluetoothSupported()
              ? html`<wa-button
                  id="btn-update-ble"
                  variant="brand"
                  ?disabled=${disabled}
                  @click=${this._updateOverBle}
                >
                  ${this._localize("web.nrf.update_ble")}
                </wa-button>`
              : nothing
          }
        `;
      }
      case "error":
        return renderRetryButton(this._localize, () => (this._state = "idle"));
      case "success":
      case "restart":
        return renderCloseButton(this._localize, this._onAfterHide);
      default:
        return nothing;
    }
  }

  protected render() {
    return html`
      <esphome-base-dialog
        .label=${this._localize("web.nrf.update_title")}
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
    filePickerStyles,
    installActionsStyles,
    css`
      .hint {
        margin: 0 0 var(--wa-space-m);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }
      .actions {
        gap: var(--wa-space-xs);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-update-nrf-dialog": ESPHomeWebUpdateNrfDialog;
  }
}
