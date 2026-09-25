import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/base-dialog.js";
import "../../components/process-terminal/process-terminal.js";
import type { ProcessTerminalState } from "../../components/process-terminal/process-terminal.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { getErrorMessage } from "../../util/error-message.js";
import { resetToBootloader } from "../../util/serial-bootloader-touch.js";
import type { Uf2Image } from "../../util/uf2.js";
import { isPortPickerCancel, requestSerialPort } from "../../util/web-serial.js";
import { isWebUsbSupported } from "../../util/web-usb.js";
import { fetchEsphomeWebManifest, picoUf2Url } from "../util/esphome-web-firmware.js";
import { picoPortFilters } from "../util/pico-port-filter.js";
import {
  flashPico,
  loadPicoImage,
  PicoFlashError,
  type PicoFlashFailure,
} from "./pico-flash.js";

import "@home-assistant/webawesome/dist/components/button/button.js";

type InstallState = "idle" | "resetting" | "reset" | "flashing" | "success" | "error";

const FAILURE_KEYS: Record<PicoFlashFailure, string> = {
  rp2350: "firmware.rp2_rp2350_device",
  "not-bootsel": "firmware.rp2_not_bootsel",
  "access-denied": "firmware.rp2_usb_access_denied",
  "device-lost": "firmware.rp2_device_lost",
  connect: "firmware.browser_flash_connect_failed",
  flash: "firmware.rp2_flash_failed",
};

/**
 * First-time Raspberry Pi Pico W setup. With WebUSB the firmware is written
 * from this page: the Pico goes into BOOTSEL (held while plugging in, or a
 * 1200 baud touch for one already running ESPHome) and Install writes the
 * manifest's UF2 over PICOBOOT. Without WebUSB the UF2 download and the
 * drag-onto-RPI-RP2 steps remain. Continue then requests the now-ESPHome
 * Pico's serial port so the caller can provision Wi-Fi.
 */
@customElement("esphome-web-install-pico-dialog")
export class ESPHomeWebInstallPicoDialog extends LitElement {
  @property({ type: Boolean }) open = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _downloadUrl?: string;
  @state() private _downloadFailed = false;
  @state() private _state: InstallState = "idle";
  @state() private _progress = 0;
  @state() private _errorMessage = "";
  // Blocks a second click while a picker or the touch is in flight.
  @state() private _pending = false;

  private _image: Promise<Uf2Image> | null = null;

  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has("open")) return;
    if (!this.open) {
      this._resetFlow();
      return;
    }
    // Retry on each (re)open while we have no URL yet — a fresh open clears the
    // prior failure and tries again, giving the user a recovery path.
    if (!this._downloadUrl) void this._loadManifest();
    // The image is fetched ahead of the click: the WebUSB chooser needs the
    // click's activation, which a download would use up.
    if (this._canFlash && !this._image) this._image = loadPicoImage();
  }

  private get _canFlash(): boolean {
    return isWebUsbSupported();
  }

  private get _busy(): boolean {
    return this._pending || this._state === "resetting" || this._state === "flashing";
  }

  private _resetFlow(): void {
    this._state = "idle";
    this._progress = 0;
    this._errorMessage = "";
    this._pending = false;
  }

  private _fail(message: string): void {
    this._errorMessage = message;
    this._state = "error";
  }

  private async _loadManifest(): Promise<void> {
    this._downloadFailed = false;
    try {
      const manifest = await fetchEsphomeWebManifest();
      this._downloadUrl = picoUf2Url(manifest);
    } catch (err) {
      this._downloadFailed = true;
      toast.error(
        this._localize("web.pico.manifest_failed", {
          error: err instanceof Error ? err.message : String(err),
        })
      );
    }
  }

  // A Pico already running ESPHome: the 1200 baud touch reboots it into
  // BOOTSEL, where Install can pick it up.
  private async _resetIntoBootsel(): Promise<void> {
    if (this._pending) return;
    this._pending = true;
    this._state = "resetting";
    try {
      const port = await requestSerialPort();
      if (!port) {
        this._state = "idle";
        return;
      }
      await resetToBootloader(port);
      this._state = "reset";
    } catch (err) {
      this._fail(this._localize("web.connect.failed", { error: getErrorMessage(err) }));
    } finally {
      this._pending = false;
    }
  }

  private async _install(): Promise<void> {
    if (this._pending) return;
    this._pending = true;
    const image = (this._image ??= loadPicoImage());
    this._state = "flashing";
    this._progress = 0;
    try {
      // The chooser runs first, inside the click; the image is normally in
      // hand already.
      const flashed = await flashPico(await image.catch(this._imageFailed), {
        onProgress: (percent) => (this._progress = percent),
      });
      this._state = flashed ? "success" : "idle";
    } catch (err) {
      if (err instanceof PicoFlashError) {
        console.warn("Pico install failed", err.cause ?? err);
        this._fail(this._localize(FAILURE_KEYS[err.kind]));
      } else {
        this._fail(
          this._localize("web.pico.install_image_failed", { error: getErrorMessage(err) })
        );
      }
    } finally {
      this._pending = false;
    }
  }

  // A failed fetch must not stick: the next Install fetches again.
  private _imageFailed = (err: unknown): never => {
    this._image = null;
    throw err;
  };

  private async _continue(): Promise<void> {
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort({ filters: picoPortFilters });
    } catch (err) {
      if (!isPortPickerCancel(err)) {
        toast.error(
          this._localize("web.connect.failed", {
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
      return;
    }
    this.dispatchEvent(
      new CustomEvent<SerialPort>("pico-connected", {
        detail: port,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onAfterHide(): void {
    this.dispatchEvent(new CustomEvent("after-hide", { bubbles: true }));
  }

  protected render() {
    return html`
      <esphome-base-dialog
        .label=${this._localize("web.pico.setup_title")}
        ?open=${this.open}
        ?busy=${this._busy}
        @after-hide=${this._onAfterHide}
      >
        ${this._canFlash ? this._renderUsbInstall() : this._renderDownloadSteps()}
      </esphome-base-dialog>
    `;
  }

  private _renderUsbInstall() {
    const running = this._state !== "idle" && this._state !== "reset";
    return html`
      <p>${this._localize("web.pico.install_intro")}</p>
      <ol>
        <li>${this._localize("web.pico.install_step_bootsel")}</li>
        <li>${this._localize("web.pico.install_step_running")}</li>
        <li>${this._localize("web.pico.install_step_install")}</li>
      </ol>
      ${running ? this._renderProgress() : nothing}
      ${
        this._state === "success"
          ? html`<p>${this._localize("web.pico.setup_continue_hint")}</p>`
          : nothing
      }
      <div class="actions">${this._renderActions()}</div>
    `;
  }

  private _terminalState(): ProcessTerminalState {
    switch (this._state) {
      case "success":
        return "success";
      case "error":
        return "error";
      default:
        return "running";
    }
  }

  private _statusMessage(): string {
    switch (this._state) {
      case "resetting":
        return this._localize("web.pico.install_resetting");
      case "flashing":
        return this._localize("web.pico.install_flashing");
      case "success":
        return this._localize("web.pico.setup_step_5");
      default:
        return this._localize("firmware.status_failed");
    }
  }

  private _renderProgress() {
    return html`
      <esphome-process-terminal
        variant="card"
        .state=${this._terminalState()}
        .statusMessage=${this._statusMessage()}
        .statusDetail=${this._state === "error" ? this._errorMessage : ""}
        .progress=${this._state === "flashing" ? this._progress : null}
      ></esphome-process-terminal>
    `;
  }

  private _renderActions() {
    switch (this._state) {
      case "idle":
      case "reset":
        return html`
          <wa-button
            variant="neutral"
            ?disabled=${this._pending}
            @click=${this._resetIntoBootsel}
          >
            ${this._localize("web.pico.install_reset_action")}
          </wa-button>
          <wa-button variant="brand" ?disabled=${this._pending} @click=${this._install}>
            ${this._localize("dashboard.install")}
          </wa-button>
        `;
      case "error":
        return html`
          <wa-button variant="neutral" @click=${this._resetFlow}>
            ${this._localize("command.retry")}
          </wa-button>
        `;
      case "success":
        return html`
          <wa-button variant="brand" @click=${this._continue}>
            ${this._localize("onboarding.wizard.continue")}
          </wa-button>
        `;
      default:
        return nothing;
    }
  }

  private _renderDownloadSteps() {
    return html`
      <p>${this._localize("web.pico.setup_intro")}</p>
      <ol>
        <li>${this._localize("web.pico.setup_step_1")}</li>
        <li>${this._localize("web.pico.setup_step_2")}</li>
        <li>
          ${
            this._downloadUrl
              ? html`<a href=${this._downloadUrl} download
                  >${this._localize("web.pico.setup_download")}</a
                >`
              : this._downloadFailed
                ? html`<span class="download-error"
                    >${this._localize("web.pico.setup_download_failed")}</span
                  >`
                : this._localize("web.pico.setup_download_loading")
          }
        </li>
        <li>${this._localize("web.pico.setup_step_4")}</li>
        <li>${this._localize("web.pico.setup_step_5")}</li>
      </ol>
      <p>${this._localize("web.pico.setup_continue_hint")}</p>
      <div class="actions">
        <wa-button variant="brand" @click=${this._continue}>
          ${this._localize("onboarding.wizard.continue")}
        </wa-button>
      </div>
    `;
  }

  static styles = [
    espHomeStyles,
    css`
      ol {
        padding-left: 1.5em;
      }
      li + li {
        margin-top: var(--wa-space-2xs);
      }
      a {
        color: var(--esphome-primary);
      }
      .download-error {
        color: var(--esphome-error);
      }
      esphome-process-terminal {
        display: block;
        margin-top: var(--wa-space-m);
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-m);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-pico-dialog": ESPHomeWebInstallPicoDialog;
  }
}
