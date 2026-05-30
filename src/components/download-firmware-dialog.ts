import { consume } from "@lit/context";
import { mdiChevronRight } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { FirmwareBinary } from "../api/types/firmware-jobs.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
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
    css`
      esphome-base-dialog {
        --width: 460px;
      }

      esphome-base-dialog::part(header) {
        background: var(--esphome-primary);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      esphome-base-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      esphome-base-dialog::part(body) {
        padding: var(--wa-space-l);
      }

      esphome-base-dialog::part(footer) {
        display: none;
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
      }

      .option {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
        padding: var(--wa-space-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        cursor: pointer;
        transition:
          background 0.12s,
          border-color 0.12s;
      }

      .option:hover {
        background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
        border-color: var(--esphome-primary);
      }

      .info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .title {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .desc {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.4;
      }

      .option-chevron {
        margin-left: auto;
        font-size: 20px;
        color: var(--wa-color-text-quiet);
        flex-shrink: 0;
        transition: color 0.12s;
      }

      .option:hover .option-chevron {
        color: var(--esphome-primary);
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
              <div class="option" @click=${() => this._select(binary)}>
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
