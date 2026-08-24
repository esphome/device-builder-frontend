import { consume } from "@lit/context";
import {
  mdiLinkOff,
  mdiRocketLaunch,
  mdiTextBoxOutline,
  mdiUpload,
  mdiWifiCog,
} from "@mdi/js";
import { html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { actionBtnStyles } from "../../styles/action-buttons.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { sleep } from "../../util/sleep.js";
import {
  IMPROV_OPEN_DELAY_MS,
  type ImprovResult,
  openImprovDialog,
} from "../improv/open-improv-dialog.js";
import "../install/esphome-web-install-adoptable-dialog.js";
import "../install/esphome-web-install-upload-dialog.js";
import { openPortForLogs } from "../logs/esphome-web-logs-dialog.js";
import { cardActionsRowStyles } from "./card-actions-row.js";
import "./esphome-web-card.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/tooltip/tooltip.js";

registerMdiIcons({
  "rocket-launch": mdiRocketLaunch,
  upload: mdiUpload,
  "text-box-outline": mdiTextBoxOutline,
  "wifi-cog": mdiWifiCog,
  "link-off": mdiLinkOff,
});

/**
 * The connected-ESP card: the hub for the per-device actions. Holds the
 * authorized ``SerialPort`` and hands it to each action's dialog, which owns
 * the open/close lifecycle.
 */
@customElement("esphome-web-esp-device-card")
export class ESPHomeWebEspDeviceCard extends LitElement {
  @property({ attribute: false }) port!: SerialPort;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _logsOpen = false;
  @state() private _uploadOpen = false;
  @state() private _adoptableOpen = false;

  private async _showLogs(): Promise<void> {
    // Open the port before showing the dialog so a connect failure surfaces a
    // toast instead of an empty terminal (the dialog streams an open port).
    if (!(await openPortForLogs(this.port, this._localize))) return;
    this._logsOpen = true;
  }

  private _showInstall(): void {
    this._uploadOpen = true;
  }

  private _showAdoptable(): void {
    this._adoptableOpen = true;
  }

  private _configureWifi(): void {
    void this._openImprov();
  }

  // Improv may have to reopen on a fresh handle (native-USB re-enumeration
  // after the post-flash reset); hand it to the parent card like the logs
  // dialog does, so the other actions stop using the dead pre-reset one.
  private _openImprov(): Promise<ImprovResult> {
    return openImprovDialog(this.port, this._localize, {
      onPortReplaced: (port) =>
        this.dispatchEvent(
          new CustomEvent("port-replaced", {
            detail: port,
            bubbles: true,
            composed: true,
          })
        ),
    });
  }

  // Fired by the adoptable dialog's Continue button after a successful flash.
  // Close the (native modal) install dialog first and let it finish hiding so
  // Improv doesn't open behind its backdrop. Waiting for the freshly-reset
  // device to re-enumerate is openImprovDialog's job (it reopens through
  // openLiveSerialPort); this.port may be a dead pre-reset handle by now.
  private async _onProvisionWifi(): Promise<void> {
    this._adoptableOpen = false;
    await sleep(IMPROV_OPEN_DELAY_MS);
    void this._openImprov();
  }

  private _disconnect(): void {
    // Close the port so it isn't stranded open until the tab closes (legacy
    // closed it on disconnect). Best-effort — the device may already be gone.
    void this.port.close().catch(() => {});
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  protected render() {
    return html`
      <esphome-web-card status=${this._localize("web.status.connected")} variant="online">
        <span slot="header">${this._localize("web.esp.title")}</span>
        ${this._localize("web.esp.connected_hint")}
        <div class="card-actions-row" slot="actions">
          <button class="action-btn action-btn--primary" @click=${this._showAdoptable}>
            <wa-icon library="mdi" name="rocket-launch"></wa-icon>
            ${this._localize("web.actions.prepare")}
          </button>
          <button
            id="btn-install"
            class="action-btn action-btn--ghost action-btn--tile"
            aria-label=${this._localize("dashboard.install")}
            @click=${this._showInstall}
          >
            <wa-icon library="mdi" name="upload"></wa-icon>
          </button>
          <wa-tooltip for="btn-install"
            >${this._localize("dashboard.install")}</wa-tooltip
          >
          <button
            id="btn-logs"
            class="action-btn action-btn--ghost action-btn--tile"
            aria-label=${this._localize("dashboard.logs")}
            @click=${this._showLogs}
          >
            <wa-icon library="mdi" name="text-box-outline"></wa-icon>
          </button>
          <wa-tooltip for="btn-logs">${this._localize("dashboard.logs")}</wa-tooltip>
          <button
            id="btn-wifi"
            class="action-btn action-btn--ghost action-btn--tile"
            aria-label=${this._localize("web.actions.configure_wifi")}
            @click=${this._configureWifi}
          >
            <wa-icon library="mdi" name="wifi-cog"></wa-icon>
          </button>
          <wa-tooltip for="btn-wifi"
            >${this._localize("web.actions.configure_wifi")}</wa-tooltip
          >
          <button
            id="btn-disconnect"
            class="action-btn action-btn--ghost action-btn--icon-only"
            aria-label=${this._localize("web.actions.disconnect")}
            @click=${this._disconnect}
          >
            <wa-icon library="mdi" name="link-off"></wa-icon>
          </button>
          <wa-tooltip for="btn-disconnect"
            >${this._localize("web.actions.disconnect")}</wa-tooltip
          >
        </div>
      </esphome-web-card>
      <esphome-web-install-adoptable-dialog
        .port=${this.port}
        ?open=${this._adoptableOpen}
        @provision-wifi=${this._onProvisionWifi}
        @after-hide=${() => (this._adoptableOpen = false)}
      ></esphome-web-install-adoptable-dialog>
      <esphome-web-install-upload-dialog
        .port=${this.port}
        ?open=${this._uploadOpen}
        @after-hide=${() => (this._uploadOpen = false)}
      ></esphome-web-install-upload-dialog>
      <esphome-web-logs-dialog
        .port=${this.port}
        ?open=${this._logsOpen}
        .deviceLabel=${this._localize("web.esp.title")}
        @after-hide=${() => (this._logsOpen = false)}
      ></esphome-web-logs-dialog>
    `;
  }

  static styles = [espHomeStyles, actionBtnStyles, cardActionsRowStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-esp-device-card": ESPHomeWebEspDeviceCard;
  }
}
