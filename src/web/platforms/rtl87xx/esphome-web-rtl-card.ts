import { html } from "lit";
import { customElement } from "lit/decorators.js";

import { RTL87XX_SERIAL_LOGS } from "../../../platforms/rtl87xx/index.js";
import {
  type LibreTinyCard,
  LibreTinyCardElement,
} from "../../dashboard/libretiny-card-element.js";
import "./esphome-web-install-rtl-dialog.js";

const RTL_CARD: LibreTinyCard = {
  copy: {
    title: "web.rtl.title",
    hint: "web.rtl.connect_hint",
    logs: "web.rtl.logs",
  },
  logs: RTL87XX_SERIAL_LOGS,
};

/** RTL87xx card: install through the chip's ROM downloader, and logs. */
@customElement("esphome-web-rtl-card")
export class ESPHomeWebRtlCard extends LibreTinyCardElement {
  protected readonly card = RTL_CARD;

  protected renderInstall(open: boolean, onHide: () => void) {
    return html`<esphome-web-install-rtl-dialog
      ?open=${open}
      @after-hide=${onHide}
    ></esphome-web-install-rtl-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-rtl-card": ESPHomeWebRtlCard;
  }
}
