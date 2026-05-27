import { consume } from "@lit/context";
import { mdiSerialPort, mdiUsb, mdiWifi } from "@mdi/js";
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { dialogCloseButtonStyles } from "../styles/dialog-close-button.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  wifi: mdiWifi,
  usb: mdiUsb,
  "serial-port": mdiSerialPort,
});

@customElement("esphome-logs-method-dialog")
export class ESPHomeLogsMethodDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ type: Boolean })
  open = false;

  static styles = [
    espHomeStyles,
    dialogCloseButtonStyles,
    css`
      wa-dialog {
        --width: 460px;
      }

      wa-dialog::part(header) {
        background: var(--esphome-primary);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      /* Close-button styling lives in
         src/styles/dialog-close-button.ts — see the
         dialogCloseButtonStyles import below. */

      wa-dialog::part(body) {
        padding: var(--wa-space-l);
      }

      wa-dialog::part(footer) {
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

      .option:hover:not(.option--disabled) {
        background: color-mix(in srgb, var(--esphome-primary), transparent 92%);
        border-color: var(--esphome-primary);
      }

      .option--disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      .option wa-icon {
        font-size: 28px;
        color: var(--esphome-primary);
        flex-shrink: 0;
      }

      .option--disabled wa-icon {
        color: var(--wa-color-text-quiet);
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
    `,
  ];

  protected render() {
    return html`
      <wa-dialog
        label=${this._localize("dashboard.logs_method_title")}
        ?open=${this.open}
        @wa-after-hide=${this._onClose}
        light-dismiss
      >
        <div class="list">
          <div class="option option--disabled">
            <wa-icon library="mdi" name="wifi"></wa-icon>
            <div class="info">
              <span class="title"
                >${this._localize("dashboard.logs_method_wireless")}</span
              >
              <span class="desc"
                >${this._localize("dashboard.logs_method_wireless_desc")}</span
              >
            </div>
          </div>
          <div class="option" @click=${this._onWebSerial}>
            <wa-icon library="mdi" name="usb"></wa-icon>
            <div class="info">
              <span class="title"
                >${this._localize("dashboard.logs_method_usb_local")}</span
              >
              <span class="desc"
                >${this._localize("dashboard.logs_method_usb_local_desc")}</span
              >
            </div>
          </div>
          <div class="option option--disabled">
            <wa-icon library="mdi" name="serial-port"></wa-icon>
            <div class="info">
              <span class="title"
                >${this._localize("dashboard.logs_method_usb_server")}</span
              >
              <span class="desc"
                >${this._localize("dashboard.logs_method_usb_server_desc")}</span
              >
            </div>
          </div>
        </div>
      </wa-dialog>
    `;
  }

  private _onClose() {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  private _onWebSerial() {
    this.dispatchEvent(new CustomEvent("web-serial", { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-logs-method-dialog": ESPHomeLogsMethodDialog;
  }
}
