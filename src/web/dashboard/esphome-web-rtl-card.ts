import { consume } from "@lit/context";
import { mdiTextBoxOutline, mdiUpload } from "@mdi/js";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import toast from "sonner-js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { actionBtnStyles } from "../../styles/action-buttons.js";
import { espHomeStyles } from "../../styles/shared.js";
import { getErrorMessage } from "../../util/error-message.js";
import { fireEvent } from "../../util/fire-event.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { requestSerialPort } from "../../util/web-serial.js";
import "../install/esphome-web-install-rtl-dialog.js";
import { openPortForLogs } from "../logs/esphome-web-logs-dialog.js";
import { releaseOrphanedPort } from "../util/release-port.js";
import { cardActionsRowStyles } from "./card-actions-row.js";
import "./esphome-web-card.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/tooltip/tooltip.js";

registerMdiIcons({ upload: mdiUpload, "text-box-outline": mdiTextBoxOutline });

/**
 * RTL8720C (AmebaZ2) card: no connected state; each install picks its own
 * port and flashes through the ROM downloader, and each logs session picks
 * its own port. The usual kits wire RTS to CEN and DTR to the PA00 download
 * strap, so a logs open releases both lines right away.
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
      let port: SerialPort | null;
      try {
        port = await requestSerialPort();
      } catch (err) {
        toast.error(
          this._localize("web.connect.failed", { error: getErrorMessage(err) })
        );
        return;
      }
      if (!port) return;
      // The shell may offer another board flow from the port's ids.
      fireEvent(this, "port-picked", port);
      if (!(await openPortForLogs(port, this._localize, { releaseLines: true }))) return;
      // A flow switch accepted while the open was pending unmounted this
      // card: nothing is left to own the port, so release it.
      if (!this.isConnected) {
        await releaseOrphanedPort(port);
        return;
      }
      this._logsPort = port;
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
        release-lines
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
