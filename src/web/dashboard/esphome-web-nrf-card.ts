import { consume } from "@lit/context";
import { mdiUpload } from "@mdi/js";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { actionBtnStyles } from "../../styles/action-buttons.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import "../install/esphome-web-install-nrf-dialog.js";
import { cardActionsRowStyles } from "./card-actions-row.js";
import "./esphome-web-card.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ upload: mdiUpload });

/**
 * nRF52 card: lets users flash DFU firmware packages onto nRF52 devices
 * via the Nordic Legacy DFU protocol over Web Serial. No persistent connected
 * state — each install is a self-contained two-step flow (reset + flash).
 */
@customElement("esphome-web-nrf-card")
export class ESPHomeWebNrfCard extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state() private _installOpen = false;

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
        </div>
      </esphome-web-card>
      <esphome-web-install-nrf-dialog
        ?open=${this._installOpen}
        @after-hide=${() => (this._installOpen = false)}
      ></esphome-web-install-nrf-dialog>
    `;
  }

  static styles = [espHomeStyles, actionBtnStyles, cardActionsRowStyles];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-nrf-card": ESPHomeWebNrfCard;
  }
}
