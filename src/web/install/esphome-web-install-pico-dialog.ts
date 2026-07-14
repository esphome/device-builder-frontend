import { consume } from "@lit/context";
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import "../../components/base-dialog.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { isPortPickerCancel } from "../../util/web-serial.js";
import { fetchEsphomeWebManifest, picoUf2Url } from "../util/esphome-web-firmware.js";
import { picoPortFilters } from "../util/pico-port-filter.js";

import "@home-assistant/webawesome/dist/components/button/button.js";

/**
 * First-time Raspberry Pi Pico W setup. The Pico installs firmware by copying
 * a UF2 to its RPI-RP2 mass-storage drive — no esptool / Web Serial flash. We
 * just surface the download link and drag-drop steps, then Continue requests
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

  protected updated(changed: Map<string, unknown>): void {
    // Retry on each (re)open while we have no URL yet — a fresh open clears the
    // prior failure and tries again, giving the user a recovery path.
    if (changed.has("open") && this.open && !this._downloadUrl) {
      void this._loadManifest();
    }
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
        @after-hide=${this._onAfterHide}
      >
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
      </esphome-base-dialog>
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
    "esphome-web-install-pico-dialog": ESPHomeWebInstallPicoDialog;
  }
}
