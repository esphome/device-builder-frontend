import { consume } from "@lit/context";
import { mdiRocketLaunch, mdiUsb } from "@mdi/js";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import toast from "sonner-js";

import type { LocalizeFunc } from "../../../common/localize.js";
import { localizeContext } from "../../../context/index.js";
import { actionBtnStyles } from "../../../styles/action-buttons.js";
import { espHomeStyles } from "../../../styles/shared.js";
import { registerMdiIcons } from "../../../util/register-icons.js";
import { sleep } from "../../../util/sleep.js";
import { PortNotAcceptedError, requestSerialPort } from "../../../util/web-serial.js";
import { cardActionsRowStyles } from "../../dashboard/card-actions-row.js";
import "./esphome-web-install-pico-dialog.js";
import {
  IMPROV_OPEN_DELAY_MS,
  openImprovDialog,
} from "../../improv/open-improv-dialog.js";
import { PortDisconnectWatcher } from "../../util/port-disconnect-watcher.js";
import { isPicoPort, picoPortFilters } from "./pico-port-filter.js";
import "../../dashboard/esphome-web-card.js";
import "./esphome-web-pico-device-card.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ usb: mdiUsb, "rocket-launch": mdiRocketLaunch });

/**
 * Raspberry Pi Pico connect card. "Connect" narrows the picker to Pico CDC
 * ports; once one is authorized it swaps to the device card. First-time
 * setup walks through the UF2 install, then continues into Wi-Fi
 * provisioning.
 */
@customElement("esphome-web-pico-connect-card")
export class ESPHomeWebPicoConnectCard extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _port?: SerialPort;
  @state() private _setupOpen = false;

  // Rides out the spurious disconnect a native-USB chip fires while
  // re-enumerating, swapping in the live handle; a real unplug still resets.
  private _watcher = new PortDisconnectWatcher(
    this,
    (port) => (this._port = port),
    () => (this._port = undefined)
  );

  protected render() {
    if (this._port) {
      return html`<esphome-web-pico-device-card
        .port=${this._port}
        @close=${this._handleClose}
        @port-replaced=${(e: CustomEvent<SerialPort>) => this._watcher.adopt(e.detail)}
      ></esphome-web-pico-device-card>`;
    }

    return html`
      <esphome-web-card
        status=${this._localize("web.status.not_connected")}
        variant="neutral"
      >
        <span slot="header">${this._localize("web.pico.title")}</span>
        ${this._localize("web.pico.connect_hint")}
        <div class="card-actions-row" slot="actions">
          <button
            class="action-btn action-btn--primary"
            @click=${() => (this._setupOpen = true)}
          >
            <wa-icon library="mdi" name="rocket-launch"></wa-icon>
            ${this._localize("web.pico.first_time_setup")}
          </button>
          <button class="action-btn action-btn--ghost" @click=${this._connect}>
            <wa-icon library="mdi" name="usb"></wa-icon>
            ${this._localize("web.actions.connect")}
          </button>
        </div>
      </esphome-web-card>
      <esphome-web-install-pico-dialog
        ?open=${this._setupOpen}
        @pico-connected=${this._onPicoConnected}
        @after-hide=${() => (this._setupOpen = false)}
      ></esphome-web-install-pico-dialog>
    `;
  }

  private async _onPicoConnected(ev: CustomEvent<SerialPort>): Promise<void> {
    // First-time setup ends by connecting the freshly-installed Pico to Wi-Fi.
    // Close the setup dialog and wait for it to finish hiding before opening
    // Improv (a native modal), or Improv would be inert behind its backdrop.
    // Only adopt the port once Improv confirms the device actually spoke it
    // (i.e. it's now running ESPHome) — matching legacy, which gated the card
    // on the "closed" event's ``improv === true``.
    const port = ev.detail;
    this._setupOpen = false;
    await sleep(IMPROV_OPEN_DELAY_MS);
    // A flow switch accepted during the pause unmounted this card; Wi-Fi
    // setup would open with nobody to adopt the port.
    if (!this.isConnected) return;
    const { improv } = await openImprovDialog(port, this._localize);
    if (improv) this._adoptPort(port);
  }

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("_port")) {
      this.toggleAttribute("connected", this._port !== undefined);
    }
  }

  private async _connect(): Promise<void> {
    let port: SerialPort | null;
    try {
      port = await requestSerialPort({ filters: picoPortFilters }, isPicoPort);
    } catch (err) {
      toast.error(
        err instanceof PortNotAcceptedError
          ? this._localize("web.pico.probe_picked")
          : this._localize("web.connect.failed", {
              error: err instanceof Error ? err.message : String(err),
            })
      );
      return;
    }
    if (port) this._adoptPort(port);
  }

  private _adoptPort(port: SerialPort): void {
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
    "esphome-web-pico-connect-card": ESPHomeWebPicoConnectCard;
  }
}
