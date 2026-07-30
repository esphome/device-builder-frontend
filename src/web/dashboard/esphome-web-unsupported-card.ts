import { consume } from "@lit/context";
import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { webSerialAvailability } from "../../util/web-serial.js";
import "./esphome-web-card.js";

/**
 * Shown when Web Serial isn't available. Distinguishes the two causes the
 * shared ``webSerialAvailability`` reports: an insecure origin (fixable —
 * reopen over https / localhost) vs. a browser that lacks the API entirely.
 */
@customElement("esphome-web-unsupported-card")
export class ESPHomeWebUnsupportedCard extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  protected render() {
    const insecure = webSerialAvailability() === "insecure-context";
    return html`
      <esphome-web-card
        status=${this._localize("web.unsupported.status")}
        variant="offline"
      >
        <span slot="header">${this._localize("web.unsupported.heading")}</span>
        ${
          insecure
            ? this._localize("web.unsupported.insecure")
            : this._localize("web.unsupported.browser")
        }
      </esphome-web-card>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-unsupported-card": ESPHomeWebUnsupportedCard;
  }
}
