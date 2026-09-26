import { consume } from "@lit/context";
import { mdiTextBoxOutline, mdiUpload } from "@mdi/js";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { actionBtnStyles } from "../../styles/action-buttons.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import "../install/esphome-web-install-rtl-dialog.js";
import { pickPortForLogs } from "../util/pick-port-for-logs.js";
import { cardActionsRowStyles } from "./card-actions-row.js";
import "./esphome-web-card.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/tooltip/tooltip.js";

registerMdiIcons({ upload: mdiUpload, "text-box-outline": mdiTextBoxOutline });

// The usual kits wire RTS to CEN and DTR to the PA00 download strap; every
// logs open (the first one here, reopens in the dialog) drops both lines.
const RTL_LOGS = { releaseLines: true };

/**
 * RTL8720C (AmebaZ2) card: no connected state; each install picks its own
 * port and flashes through the ROM downloader, and each logs session picks
 * its own port.
 */
@customElement("esphome-web-rtl-card")
export class ESPHomeWebRtlCard extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _installOpen = false;
  @state() private _logsPort?: SerialPort;
  // A picker is up; a second click must not open another beside it.
  private _picking = false;

  private async _showLogs(): Promise<void> {
    if (this._picking || this._logsPort) return;
    this._picking = true;
    try {
      const port = await pickPortForLogs(this, this._localize, RTL_LOGS);
      if (port) this._logsPort = port;
    } finally {
      this._picking = false;
    }
  }

  private _onLogsHidden(): void {
    this._logsPort = undefined;
  }

  protected render() {
    return html`
      <esphome-web-card
        status=${this._localize("web.status.not_connected")}
        variant="neutral"
      >
        <span slot="header">${this._localize("web.rtl.title")}</span>
        ${this._localize("web.rtl.connect_hint")}
        <div class="card-actions-row" slot="actions">
          <button
            class="action-btn action-btn--primary"
            @click=${() => (this._installOpen = true)}
          >
            <wa-icon library="mdi" name="upload"></wa-icon>
            ${this._localize("dashboard.install")}
          </button>
          <button
            id="btn-logs"
            class="action-btn action-btn--ghost action-btn--tile"
            aria-label=${this._localize("web.rtl.logs")}
            @click=${this._showLogs}
          >
            <wa-icon library="mdi" name="text-box-outline"></wa-icon>
          </button>
          <wa-tooltip for="btn-logs">${this._localize("web.rtl.logs")}</wa-tooltip>
        </div>
      </esphome-web-card>
      <esphome-web-install-rtl-dialog
        ?open=${this._installOpen}
        @after-hide=${() => (this._installOpen = false)}
      ></esphome-web-install-rtl-dialog>
      <esphome-web-logs-dialog
        .port=${this._logsPort}
        ?open=${this._logsPort !== undefined}
        .deviceLabel=${this._localize("web.rtl.title")}
        .resetMode=${"rts"}
        ?release-lines=${RTL_LOGS.releaseLines}
        @after-hide=${this._onLogsHidden}
      ></esphome-web-logs-dialog>
    `;
  }

  static styles = [espHomeStyles, actionBtnStyles, cardActionsRowStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-rtl-card": ESPHomeWebRtlCard;
  }
}
