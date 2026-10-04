import { html } from "lit";
import { customElement } from "lit/decorators.js";

import { LN882X_SERIAL_LOGS } from "../../../platforms/ln882x/index.js";
import {
  type LibreTinyCard,
  LibreTinyCardElement,
} from "../../dashboard/libretiny-card-element.js";
import "./esphome-web-install-ln-dialog.js";

const LN_CARD: LibreTinyCard = {
  copy: {
    title: "web.ln.title",
    hint: "web.ln.connect_hint",
    logs: "web.ln.logs",
  },
  logs: LN882X_SERIAL_LOGS,
};

/** LN882H card: install through the chip's UART downloader, and logs. */
@customElement("esphome-web-ln-card")
export class ESPHomeWebLnCard extends LibreTinyCardElement {
  protected readonly card = LN_CARD;

  protected renderInstall(open: boolean, onHide: () => void) {
    return html`<esphome-web-install-ln-dialog
      ?open=${open}
      @after-hide=${onHide}
    ></esphome-web-install-ln-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-ln-card": ESPHomeWebLnCard;
  }
}
