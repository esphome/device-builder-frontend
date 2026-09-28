import { html } from "lit";
import { customElement } from "lit/decorators.js";

import { BK72XX_SERIAL_LOGS } from "../../../platforms/bk72xx/index.js";
import {
  type LibreTinyCard,
  LibreTinyCardElement,
} from "../../dashboard/libretiny-card-element.js";
import "./esphome-web-install-bk-dialog.js";

const BK_CARD: LibreTinyCard = {
  copy: {
    title: "web.bk.title",
    hint: "web.bk.connect_hint",
    logs: "web.bk.logs",
  },
  logs: BK72XX_SERIAL_LOGS,
};

/** Beken BK72xx card: install through the chip's UART downloader, and logs. */
@customElement("esphome-web-bk-card")
export class ESPHomeWebBkCard extends LibreTinyCardElement {
  protected readonly card = BK_CARD;

  protected renderInstall(open: boolean, onHide: () => void) {
    return html`<esphome-web-install-bk-dialog
      ?open=${open}
      @after-hide=${onHide}
    ></esphome-web-install-bk-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-bk-card": ESPHomeWebBkCard;
  }
}
