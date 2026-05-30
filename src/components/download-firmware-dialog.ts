import { consume } from "@lit/context";
import { mdiChevronRight } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { FirmwareBinary } from "../api/types/firmware-jobs.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { dialogOptionStyles, espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./base-dialog.js";

registerMdiIcons({
  "chevron-right": mdiChevronRight,
});

/**
 * Format picker for the three-dot "Download firmware" action. ESP32
 * (and other multi-artefact platforms) expose more than one binary —
 * Factory for fresh flashes / ESPHome Web, OTA for HTTP updates — and
 * the dashboard otherwise silently grabbed only the first. The list is
 * platform-supplied (``firmware/get_binaries`` → ESPHome's
 * ``get_download_types``); the chosen entry bubbles up as
 * ``download-binary`` so the dashboard performs the actual download.
 */
@customElement("esphome-download-firmware-dialog")
export class ESPHomeDownloadFirmwareDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _open = false;
  @state() private _device: ConfiguredDevice | null = null;
  @state() private _binaries: FirmwareBinary[] = [];

  static styles = [
    espHomeStyles,
    dialogOptionStyles,
    css`
      .option:focus-visible {
        outline: 2px solid var(--esphome-primary);
        outline-offset: 2px;
      }
    `,
  ];

  open(device: ConfiguredDevice, binaries: FirmwareBinary[]) {
    this._device = device;
    this._binaries = binaries;
    this._open = true;
  }

  close() {
    this._open = false;
  }

  private _onAfterHide = (): void => {
    this._open = false;
  };

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${this._localize("dashboard.download_select_title")}
        @after-hide=${this._onAfterHide}
      >
        <div class="list">
          ${this._binaries.map(
            (binary) => html`
              <div
                class="option"
                role="button"
                tabindex="0"
                @click=${() => this._select(binary)}
                @keydown=${(e: KeyboardEvent) => this._onOptionKeydown(e, binary)}
              >
                <div class="info">
                  <span class="title">${binary.title}</span>
                  ${binary.description
                    ? html`<span class="desc">${binary.description}</span>`
                    : nothing}
                </div>
                <wa-icon
                  class="option-chevron"
                  library="mdi"
                  name="chevron-right"
                ></wa-icon>
              </div>
            `
          )}
        </div>
      </esphome-base-dialog>
    `;
  }

  private _onOptionKeydown(e: KeyboardEvent, binary: FirmwareBinary) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this._select(binary);
    }
  }

  private _select(binary: FirmwareBinary) {
    const device = this._device;
    this._open = false;
    if (!device) return;
    this.dispatchEvent(
      new CustomEvent("download-binary", {
        detail: { device, binary },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-download-firmware-dialog": ESPHomeDownloadFirmwareDialog;
  }
}
