import { consume } from "@lit/context";
import { mdiBluetooth, mdiTextBoxOutline, mdiUpload } from "@mdi/js";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { pickBleNusDevice } from "../../../platforms/nrf52/index.js";
import { NRF52_SERIAL_LOGS } from "../../../platforms/nrf52/index.js";
import { actionBtnStyles } from "../../../styles/action-buttons.js";
import { espHomeStyles } from "../../../styles/shared.js";
import "./esphome-web-install-nrf-dialog.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { cardActionsRowStyles } from "../../dashboard/card-actions-row.js";
import "../../logs/esphome-web-logs-dialog.js";
import { pickPortForLogs } from "../../util/pick-port-for-logs.js";
import "../../dashboard/esphome-web-card.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/tooltip/tooltip.js";

registerMdiIcons({
  upload: mdiUpload,
  "text-box-outline": mdiTextBoxOutline,
  bluetooth: mdiBluetooth,
});

/** What the open logs dialog streams from; one or the other, never both. */
type LogsSource = { port: SerialPort } | { ble: BluetoothDevice };

/**
 * nRF52 card: no connected state; each install is a self-contained reset +
 * flash, and each logs session picks its own port or Bluetooth device.
 */
@customElement("esphome-web-nrf-card")
export class ESPHomeWebNrfCard extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _installOpen = false;
  @state() private _logs?: LogsSource;
  // A chooser is up; a second click must not open another beside it. A
  // session still set (the dialog open, or hiding with its after-hide yet to
  // clear it) blocks the same way, so a stale hide can never clear a newer
  // session.
  private _picking = false;
  private get _busy(): boolean {
    return this._picking || this._logs !== undefined;
  }

  private async _showSerialLogs(): Promise<void> {
    if (this._busy) return;
    this._picking = true;
    try {
      const port = await pickPortForLogs(this, this._localize, NRF52_SERIAL_LOGS);
      if (port) this._logs = { port };
    } finally {
      this._picking = false;
    }
  }

  private async _showBleLogs(): Promise<void> {
    if (this._busy) return;
    this._picking = true;
    try {
      const ble = await pickBleNusDevice(this._localize, []);
      if (ble) this._logs = { ble };
    } finally {
      this._picking = false;
    }
  }

  private _onLogsHidden(): void {
    this._logs = undefined;
  }

  protected render() {
    const logs = this._logs;
    return html`
      <esphome-web-card
        status=${this._localize("web.status.not_connected")}
        variant="neutral"
      >
        <span slot="header">${this._localize("web.nrf.title")}</span>
        ${this._localize("web.nrf.connect_hint")}
        <div class="card-actions-row" slot="actions">
          <button
            class="action-btn action-btn--primary"
            @click=${() => (this._installOpen = true)}
          >
            <wa-icon library="mdi" name="upload"></wa-icon>
            ${this._localize("dashboard.install")}
          </button>
          <button
            id="btn-logs-usb"
            class="action-btn action-btn--ghost action-btn--tile"
            aria-label=${this._localize("web.nrf.logs_usb")}
            @click=${this._showSerialLogs}
          >
            <wa-icon library="mdi" name="text-box-outline"></wa-icon>
          </button>
          <wa-tooltip for="btn-logs-usb"
            >${this._localize("web.nrf.logs_usb")}</wa-tooltip
          >
          <button
            id="btn-logs-ble"
            class="action-btn action-btn--ghost action-btn--tile"
            aria-label=${this._localize("web.nrf.logs_ble")}
            @click=${this._showBleLogs}
          >
            <wa-icon library="mdi" name="bluetooth"></wa-icon>
          </button>
          <wa-tooltip for="btn-logs-ble"
            >${this._localize("web.nrf.logs_ble")}</wa-tooltip
          >
        </div>
      </esphome-web-card>
      <esphome-web-install-nrf-dialog
        ?open=${this._installOpen}
        @after-hide=${() => (this._installOpen = false)}
      ></esphome-web-install-nrf-dialog>
      <esphome-web-logs-dialog
        .port=${logs && "port" in logs ? logs.port : undefined}
        .bleDevice=${logs && "ble" in logs ? logs.ble : undefined}
        ?open=${logs !== undefined}
        .deviceLabel=${this._localize("web.nrf.title")}
        .policy=${NRF52_SERIAL_LOGS}
        @after-hide=${this._onLogsHidden}
      ></esphome-web-logs-dialog>
    `;
  }

  static styles = [espHomeStyles, actionBtnStyles, cardActionsRowStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-nrf-card": ESPHomeWebNrfCard;
  }
}
