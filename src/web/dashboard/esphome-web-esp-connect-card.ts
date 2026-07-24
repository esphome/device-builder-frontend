import { consume } from "@lit/context";
import { mdiUsb } from "@mdi/js";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { actionBtnStyles } from "../../styles/action-buttons.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { isPortPickerCancel } from "../../util/web-serial.js";
import { PortDisconnectWatcher } from "../util/port-disconnect-watcher.js";
import { cardActionsRowStyles } from "./card-actions-row.js";
import "./esphome-web-card.js";
import "./esphome-web-esp-device-card.js";
import { openNoPortPickedDialog } from "./esphome-web-no-port-picked-dialog.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ usb: mdiUsb });

/**
 * ESP connect card: the "Not connected" entry point. Prompts for a serial
 * port and, once one is authorized, swaps to the device card. The port is
 * authorized but not opened here — each device action opens it for its own
 * use (see the port-ownership note in the device card / logs dialog).
 */
@customElement("esphome-web-esp-connect-card")
export class ESPHomeWebEspConnectCard extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _port?: SerialPort;

  // Rides out the spurious disconnect a native-USB chip fires while
  // re-enumerating, swapping in the live handle; a real unplug still resets.
  private _watcher = new PortDisconnectWatcher(
    this,
    (port) => (this._port = port),
    () => (this._port = undefined)
  );

  // The logs dialog recovered a live handle from a read-error disconnect
  // the watcher never saw (no DOM disconnect event fires for those); fold
  // it in so the card's other actions use the live handle too.
  private _onPortReplaced = (e: CustomEvent<SerialPort>): void => {
    this._port = e.detail;
    this._watcher.watch(e.detail);
  };

  protected render() {
    if (this._port) {
      return html`<esphome-web-esp-device-card
        .port=${this._port}
        @close=${this._handleClose}
        @port-replaced=${this._onPortReplaced}
      ></esphome-web-esp-device-card>`;
    }

    return html`
      <esphome-web-card
        status=${this._localize("web.status.not_connected")}
        variant="neutral"
      >
        <span slot="header">${this._localize("web.esp.title")}</span>
        ${this._localize("web.esp.connect_hint")}
        <div class="card-actions-row" slot="actions">
          <button class="action-btn action-btn--primary" @click=${this._connect}>
            <wa-icon library="mdi" name="usb"></wa-icon>
            ${this._localize("web.actions.connect")}
          </button>
        </div>
      </esphome-web-card>
    `;
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("_port")) {
      this.toggleAttribute("connected", this._port !== undefined);
    }
  }

  private async _connect(): Promise<void> {
    let port: SerialPort;
    try {
      port = await navigator.serial.requestPort();
    } catch (err) {
      if (isPortPickerCancel(err)) {
        // Cancelled / no device listed: offer driver help + a retry, matching
        // the legacy site rather than silently doing nothing.
        openNoPortPickedDialog(this._localize, () => void this._connect());
      } else {
        toast.error(
          this._localize("web.connect.failed", {
            error: err instanceof Error ? err.message : String(err),
          })
        );
      }
      return;
    }
    this._port = port;
    this._watcher.watch(port);
  }

  private _handleClose = (): void => {
    this._watcher.unwatch();
    this._port = undefined;
  };

  static styles = [espHomeStyles, actionBtnStyles, cardActionsRowStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-esp-connect-card": ESPHomeWebEspConnectCard;
  }
}
