import { consume } from "@lit/context";
import { mdiBluetooth, mdiTextBoxOutline, mdiUpload } from "@mdi/js";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { actionBtnStyles } from "../../styles/action-buttons.js";
import { espHomeStyles } from "../../styles/shared.js";
import {
  BleUnavailableError,
  bleUnavailableReason,
  isWebBluetoothSupported,
  requestBleNusDevice,
} from "../../util/ble-nus-stream.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { requestSerialPort } from "../../util/web-serial.js";
import "../install/esphome-web-install-nrf-dialog.js";
import { openPortForLogs } from "../logs/esphome-web-logs-dialog.js";
import { cardActionsRowStyles } from "./card-actions-row.js";
import "./esphome-web-card.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/tooltip/tooltip.js";

registerMdiIcons({
  upload: mdiUpload,
  "text-box-outline": mdiTextBoxOutline,
  bluetooth: mdiBluetooth,
});

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
  @state() private _logsOpen = false;
  @state() private _logsPort?: SerialPort;
  @state() private _logsBle?: BluetoothDevice;

  // Pick and open the CDC port in the click gesture, so a failure lands as a
  // toast instead of an empty terminal (the dialog streams an open port).
  private async _showSerialLogs(): Promise<void> {
    let port: SerialPort | null;
    try {
      port = await requestSerialPort();
    } catch (err) {
      toast.error(
        this._localize("web.logs.open_failed", {
          error: err instanceof Error ? err.message : String(err),
        })
      );
      return;
    }
    if (!port || !(await openPortForLogs(port, this._localize))) return;
    this._logsBle = undefined;
    this._logsPort = port;
    this._logsOpen = true;
  }

  // The chooser must open inside the click; whether the adapter is usable is
  // only told apart afterwards, as the dashboard does.
  private async _showBleLogs(): Promise<void> {
    if (!isWebBluetoothSupported()) {
      toast.error(this._localize("dashboard.logs_ble_nus_unsupported"));
      return;
    }
    let device: BluetoothDevice | null;
    try {
      device = await requestBleNusDevice([]);
    } catch (err) {
      if (err instanceof BleUnavailableError) {
        const brave = (await bleUnavailableReason()) === "brave";
        toast.error(this._localize("dashboard.logs_ble_nus_unavailable"), {
          description: brave
            ? this._localize("dashboard.logs_method_ble_nus_brave")
            : undefined,
        });
      } else {
        toast.error(this._localize("dashboard.logs_ble_nus_open_failed"));
      }
      return;
    }
    if (!device) return;
    this._logsPort = undefined;
    this._logsBle = device;
    this._logsOpen = true;
  }

  private _onLogsHidden(): void {
    this._logsOpen = false;
    this._logsPort = undefined;
    this._logsBle = undefined;
  }

  protected render() {
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
        .port=${this._logsPort}
        .bleDevice=${this._logsBle}
        ?open=${this._logsOpen}
        .deviceLabel=${this._localize("web.nrf.title")}
        .noReset=${true}
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
