import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/base-dialog.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { getErrorMessage } from "../../util/error-message.js";
import { flashPico, PicoFlashError, picoFlashFailureCopy } from "../../util/rp2-flash.js";
import { touchIntoBootloader } from "../../util/serial-bootloader-touch.js";
import type { Uf2Image } from "../../util/uf2.js";
import { isPortPickerCancel } from "../../util/web-serial.js";
import { isWebUsbSupported, loadPicoboot } from "../../util/web-usb.js";
import { fetchEsphomeWebManifest, picoUf2Url } from "../util/esphome-web-firmware.js";
import { picoPortFilters } from "../util/pico-port-filter.js";
import { type ProgressCard, renderProgressCard } from "./install-progress.js";
import { loadPicoImage } from "./pico-image.js";

import "@home-assistant/webawesome/dist/components/button/button.js";

type InstallState =
  "idle" | "resetting" | "waiting" | "connecting" | "flashing" | "success" | "error";

/**
 * First-time Raspberry Pi Pico W setup. With WebUSB, Install writes the
 * manifest's UF2 over PICOBOOT to a Pico in BOOTSEL; otherwise the UF2
 * download and the drag-onto-RPI-RP2 steps remain. Continue then requests
 * the now-ESPHome Pico's serial port so the caller can provision Wi-Fi.
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
  @state() private _errorTitle = "";
  @state() private _errorMessage = "";
  @state() private _logLines: string[] = [];

  private _log = (line: string) => {
    this._logLines = [...this._logLines, line];
  };

  // The parsed image, kept across opens; a failed fetch clears it so the
  // next open or Install fetches again.
  private _image: Promise<Uf2Image> | null = null;

  protected updated(changed: Map<string, unknown>): void {
    if (!changed.has("open")) return;
    if (!this.open) {
      this._resetFlow();
      return;
    }
    if (isWebUsbSupported()) {
      // Fetched ahead of the click: the WebUSB chooser needs the click's
      // activation, which a download would use up. The engine chunk warms too.
      void this._fetchImage();
      void loadPicoboot().catch(() => {});
    } else if (!this._downloadUrl) {
      // Retry on each (re)open while we have no URL yet, so a failure has a
      // recovery path.
      void this._loadManifest();
    }
  }

  private get _busy(): boolean {
    return (
      this._state === "resetting" ||
      this._state === "connecting" ||
      this._state === "flashing"
    );
  }

  private _resetFlow(): void {
    this._state = "idle";
    this._progress = 0;
    this._errorTitle = "";
    this._errorMessage = "";
    this._logLines = [];
  }

  private _fail(title: string, detail = ""): void {
    this._errorTitle = title;
    this._errorMessage = detail;
    this._state = "error";
  }

  private _fetchImage(): Promise<Uf2Image> {
    if (!this._image) {
      const image = loadPicoImage();
      image.catch(() => {
        if (this._image === image) this._image = null;
      });
      this._image = image;
    }
    return this._image;
  }

  private async _loadManifest(): Promise<void> {
    this._downloadFailed = false;
    try {
      const manifest = await fetchEsphomeWebManifest();
      this._downloadUrl = picoUf2Url(manifest);
    } catch (err) {
      this._downloadFailed = true;
      toast.error(
        this._localize("web.pico.manifest_failed", { error: getErrorMessage(err) })
      );
    }
  }

  // A Pico already running ESPHome: the 1200 baud touch reboots it into
  // BOOTSEL, where Install can pick it up.
  private async _resetIntoBootsel(): Promise<void> {
    this._logLines = [];
    this._state = "resetting";
    try {
      const touched = await touchIntoBootloader({
        filters: picoPortFilters,
        onLog: this._log,
      });
      this._state = touched ? "waiting" : "idle";
    } catch (err) {
      this._fail(
        this._localize("firmware.browser_flash_connect_failed"),
        getErrorMessage(err)
      );
    }
  }

  private async _install(): Promise<void> {
    // Installing after the reset step continues that run's log.
    if (this._state !== "waiting") this._logLines = [];
    // The chooser opens first, inside the click, with the image possibly
    // still downloading behind it; the write starts once the device is claimed.
    this._state = "connecting";
    this._progress = 0;
    try {
      const flashed = await flashPico(this._fetchImage(), {
        onDeviceOpened: () => (this._state = "flashing"),
        onProgress: (percent) => (this._progress = percent),
        onLog: this._log,
      });
      this._state = flashed ? "success" : "idle";
    } catch (err) {
      console.warn(
        "Pico install failed",
        err instanceof PicoFlashError ? (err.cause ?? err) : err
      );
      this._fail(...this._failureCopy(err));
    }
  }

  // The shared copy, except where this page's own words fit better: its
  // reset button has another name, and the image is this page's download.
  private _failureCopy(err: unknown): [string, string] {
    if (!(err instanceof PicoFlashError)) {
      return [this._localize("firmware.rp2_flash_failed"), getErrorMessage(err)];
    }
    if (err.kind === "image") {
      const error = getErrorMessage(err.cause);
      return [this._localize("web.pico.install_image_failed", { error }), ""];
    }
    const { title, detail } = picoFlashFailureCopy(err, this._localize);
    return [
      err.kind === "not-bootsel" ? this._localize("web.pico.install_not_bootsel") : title,
      detail,
    ];
  }

  private async _continue(): Promise<void> {
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort({ filters: picoPortFilters });
    } catch (err) {
      if (!isPortPickerCancel(err)) {
        toast.error(
          this._localize("web.connect.failed", { error: getErrorMessage(err) })
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
        ${isWebUsbSupported() ? this._renderUsbInstall() : this._renderDownloadSteps()}
      </esphome-base-dialog>
    `;
  }

  // The setup steps are for the start; once a step runs, the card says
  // where things stand and what to do next.
  private _renderUsbInstall() {
    return html`
      ${
        this._state === "idle"
          ? html`
              <p>${this._localize("web.pico.install_intro")}</p>
              <p>${this._localize("web.pico.install_bootsel_lead")}</p>
              <ul>
                <li>${this._localize("web.pico.install_step_bootsel")}</li>
                <li>${this._localize("web.pico.install_step_running")}</li>
              </ul>
              <p>${this._localize("web.pico.install_step_install")}</p>
            `
          : renderProgressCard({ ...this._card(), log: this._logLines }, this._localize)
      }
      ${
        this._state === "success"
          ? html`<p>${this._localize("web.pico.setup_continue_hint")}</p>`
          : nothing
      }
      <div class="actions">${this._renderActions()}</div>
    `;
  }

  private _card(): ProgressCard {
    switch (this._state) {
      case "resetting":
        return { state: "running", message: this._localize("firmware.rp2_resetting") };
      case "connecting":
        return {
          state: "running",
          message: this._localize("firmware.status_connecting"),
        };
      case "waiting":
        return {
          state: null,
          message: this._localize("firmware.rp2_wait_title"),
          detail: this._localize("web.pico.install_waiting"),
        };
      case "flashing":
        return {
          state: "running",
          message: this._localize("firmware.status_flashing"),
          progress: this._progress,
        };
      case "success":
        return { state: "success", message: this._localize("web.pico.setup_step_5") };
      default:
        return { state: "error", message: this._errorTitle, detail: this._errorMessage };
    }
  }

  private _renderActions() {
    switch (this._state) {
      case "idle":
      case "waiting":
        return html`
          <wa-button variant="neutral" @click=${this._resetIntoBootsel}>
            ${this._localize("web.pico.install_reset_action")}
          </wa-button>
          <wa-button variant="brand" @click=${this._install}>
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
      ol,
      ul {
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
