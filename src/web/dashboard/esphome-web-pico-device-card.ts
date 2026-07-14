import { consume } from "@lit/context";
import { mdiLinkOff, mdiTextBoxOutline, mdiWifiCog } from "@mdi/js";
import { LitElement, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { actionBtnStyles } from "../../styles/action-buttons.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { openImprovDialog } from "../improv/open-improv-dialog.js";
import { openPortForLogs } from "../logs/esphome-web-logs-dialog.js";
import { cardActionsRowStyles } from "./card-actions-row.js";
import "./esphome-web-card.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "text-box-outline": mdiTextBoxOutline,
  "wifi-cog": mdiWifiCog,
  "link-off": mdiLinkOff,
});

/**
 * The connected-Pico card. Holds the authorized ``SerialPort`` for its
 * actions (logs, Improv Wi-Fi provisioning).
 */
@customElement("esphome-web-pico-device-card")
export class ESPHomeWebPicoDeviceCard extends LitElement {
  @property({ attribute: false }) port!: SerialPort;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _logsOpen = false;

  private async _showLogs(): Promise<void> {
    // Open the port before showing the dialog so a connect failure surfaces a
    // toast instead of an empty terminal (the dialog streams an open port).
    if (!(await openPortForLogs(this.port, this._localize))) return;
    this._logsOpen = true;
  }

  private _configureWifi(): void {
    void openImprovDialog(this.port, this._localize);
  }

  private _disconnect(): void {
    // Close the port so it isn't stranded open until the tab closes (legacy
    // pico-device-card did this). Best-effort — the device may already be gone.
    void this.port.close().catch(() => {});
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }

  protected render() {
    return html`
      <esphome-web-card status=${this._localize("web.status.connected")} variant="online">
        <span slot="header">${this._localize("web.pico.title")}</span>
        ${this._localize("web.pico.connected_hint")}
        <div class="card-actions-row" slot="actions">
          <button class="action-btn action-btn--primary" @click=${this._configureWifi}>
            <wa-icon library="mdi" name="wifi-cog"></wa-icon>
            ${this._localize("web.actions.configure_wifi")}
          </button>
          <button
            class="action-btn action-btn--ghost action-btn--tile"
            title=${this._localize("dashboard.logs")}
            aria-label=${this._localize("dashboard.logs")}
            @click=${this._showLogs}
          >
            <wa-icon library="mdi" name="text-box-outline"></wa-icon>
          </button>
          <button
            class="action-btn action-btn--ghost action-btn--icon-only"
            title=${this._localize("web.actions.disconnect")}
            aria-label=${this._localize("web.actions.disconnect")}
            @click=${this._disconnect}
          >
            <wa-icon library="mdi" name="link-off"></wa-icon>
          </button>
        </div>
      </esphome-web-card>
      <esphome-web-logs-dialog
        .port=${this.port}
        ?open=${this._logsOpen}
        .deviceLabel=${this._localize("web.pico.title")}
        .isPico=${true}
        @after-hide=${() => (this._logsOpen = false)}
      ></esphome-web-logs-dialog>
    `;
  }

  static styles = [espHomeStyles, actionBtnStyles, cardActionsRowStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-pico-device-card": ESPHomeWebPicoDeviceCard;
  }
}
