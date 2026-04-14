import { consume } from "@lit/context";
import {
  mdiCheckboxBlankOutline,
  mdiCheckboxMarked,
  mdiConsole,
  mdiDelete,
  mdiDotsVertical,
  mdiPencil,
  mdiUpload,
  mdiWifi,
  mdiWifiOff,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dropdown-item/dropdown-item.js";
import "@home-assistant/webawesome/dist/components/dropdown/dropdown.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "checkbox-blank-outline": mdiCheckboxBlankOutline,
  "checkbox-marked": mdiCheckboxMarked,
  console: mdiConsole,
  pencil: mdiPencil,
  upload: mdiUpload,
  "dots-vertical": mdiDotsVertical,
  wifi: mdiWifi,
  "wifi-off": mdiWifiOff,
  delete: mdiDelete,
});

@customElement("esphome-device-card")
export class ESPHomeDeviceCard extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  name = "";

  @property()
  configuration = "";

  @property({ type: Boolean })
  online = false;

  @property({ type: Boolean, attribute: "select-mode" })
  selectMode = false;

  @property({ type: Boolean })
  selected = false;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      .device-card {
        border-radius: var(--wa-border-radius-l);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-raised);
        overflow: visible;
        display: flex;
        flex-direction: column;
        transition: box-shadow 0.15s;
      }

      .device-card:hover {
        box-shadow: var(--wa-shadow-m);
      }

      .device-card--selectable {
        cursor: pointer;
      }

      .device-card--selected {
        border-color: var(--esphome-primary);
        background: color-mix(in srgb, var(--esphome-primary), transparent 95%);
      }

      .device-card-header {
        padding: var(--wa-space-m) var(--wa-space-m) var(--wa-space-s);
        border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--wa-space-xs);
      }

      .device-card-header:last-child {
        border-bottom: none;
      }

      .device-card-header-left {
        flex: 1;
        min-width: 0;
      }

      .device-name {
        margin: 0 0 var(--wa-space-2xs);
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .device-config {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .device-status {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        border-radius: 999px;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        letter-spacing: 0.02em;
        flex-shrink: 0;
        margin-top: 2px;
      }

      .device-status.offline {
        background: color-mix(in srgb, var(--esphome-error), transparent 85%);
        color: var(--esphome-error);
      }

      .device-status.online {
        background: color-mix(in srgb, var(--esphome-success), transparent 85%);
        color: var(--esphome-success);
      }

      .device-status wa-icon {
        font-size: 13px;
      }

      .device-checkbox {
        font-size: 22px;
        color: var(--wa-color-text-quiet);
        flex-shrink: 0;
        transition: color 0.12s;
      }

      .device-checkbox--checked {
        color: var(--esphome-primary);
      }

      /* ─── Action buttons ─── */

      .device-actions {
        display: flex;
        align-items: center;
        gap: var(--wa-space-2xs);
        padding: var(--wa-space-s) var(--wa-space-m);
      }

      .action-btn {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 5px 12px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: var(--wa-border-width-s) solid transparent;
        transition:
          background 0.12s,
          border-color 0.12s;
        white-space: nowrap;
        min-width: 0;
      }

      .action-btn wa-icon {
        font-size: 15px;
      }

      .action-btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .action-btn--primary:hover {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .action-btn--accent {
        background: color-mix(in srgb, var(--esphome-primary), transparent 90%);
        color: var(--esphome-primary);
        border-color: color-mix(in srgb, var(--esphome-primary), transparent 70%);
      }

      .action-btn--accent:hover {
        background: color-mix(in srgb, var(--esphome-primary), transparent 82%);
        border-color: var(--esphome-primary);
      }

      .action-btn--ghost {
        background: transparent;
        color: var(--wa-color-text-normal);
        border-color: var(--wa-color-surface-border);
      }

      .action-btn--ghost:hover {
        background: var(--wa-color-surface-lowered);
        border-color: var(--wa-color-text-quiet);
      }

      .action-btn--icon-only {
        padding: 5px;
        flex-shrink: 0;
      }
    `,
  ];

  protected render() {
    return html`
      <div
        class="device-card ${this.selectMode ? "device-card--selectable" : ""} ${this.selectMode && this.selected ? "device-card--selected" : ""}"
        @click=${this.selectMode ? () => this._emit("toggle-select") : nothing}
      >
        <div class="device-card-header">
          ${this.selectMode
            ? html`
                <wa-icon
                  class="device-checkbox ${this.selected ? "device-checkbox--checked" : ""}"
                  library="mdi"
                  name=${this.selected ? "checkbox-marked" : "checkbox-blank-outline"}
                ></wa-icon>
              `
            : nothing}
          <div class="device-card-header-left">
            <h3 class="device-name">${this.name}</h3>
            <p class="device-config">${this.configuration}</p>
          </div>
          <div class="device-status ${this.online ? "online" : "offline"}">
            <wa-icon library="mdi" name=${this.online ? "wifi" : "wifi-off"}></wa-icon>
            ${this.online
              ? this._localize("dashboard.online")
              : this._localize("dashboard.offline")}
          </div>
        </div>
        ${!this.selectMode
          ? html`
              <div class="device-actions">
                <button
                  class="action-btn action-btn--primary"
                  @click=${() => this._emit("edit-device")}
                >
                  <wa-icon library="mdi" name="pencil"></wa-icon>
                  ${this._localize("dashboard.edit")}
                </button>
                <button
                  class="action-btn action-btn--accent"
                  @click=${() => this._emit("update-device")}
                >
                  <wa-icon library="mdi" name="upload"></wa-icon>
                  ${this._localize("dashboard.update")}
                </button>
                <button
                  class="action-btn action-btn--ghost"
                  @click=${() => this._emit("open-logs")}
                >
                  <wa-icon library="mdi" name="console"></wa-icon>
                  ${this._localize("dashboard.logs")}
                </button>
                <wa-dropdown
                  placement="right-start"
                  distance="4"
                  @wa-select=${() => this._emit("delete-device")}
                >
                  <button
                    slot="trigger"
                    class="action-btn action-btn--ghost action-btn--icon-only"
                    aria-label=${this._localize("dashboard.more_options")}
                  >
                    <wa-icon library="mdi" name="dots-vertical"></wa-icon>
                  </button>
                  <wa-dropdown-item .variant=${"danger"}>
                    <wa-icon slot="icon" library="mdi" name="delete"></wa-icon>
                    ${this._localize("dashboard.delete")}
                  </wa-dropdown-item>
                </wa-dropdown>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  private _emit(name: string) {
    this.dispatchEvent(
      new CustomEvent(name, { bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-device-card": ESPHomeDeviceCard;
  }
}
