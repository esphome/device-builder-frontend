import { html } from "lit";
import { customElement } from "lit/decorators.js";

import { RTL87XX_SERIAL_LOGS } from "../../../platforms/rtl87xx/index.js";
import {
  type LibreTinyCard,
  LibreTinyCardElement,
} from "../../dashboard/libretiny-card-element.js";
import "./esphome-web-install-rtl-ambz-dialog.js";

const RTL_AMBZ_CARD: LibreTinyCard = {
  copy: {
    title: "web.rtl_ambz.title",
    hint: "web.rtl_ambz.connect_hint",
    logs: "web.rtl_ambz.logs",
  },
  logs: RTL87XX_SERIAL_LOGS,
};

/** RTL8710B (AmebaZ) card: install through the ROM downloader, and logs. */
@customElement("esphome-web-rtl-ambz-card")
export class ESPHomeWebRtlAmbzCard extends LibreTinyCardElement {
  protected readonly card = RTL_AMBZ_CARD;

  protected renderInstall(open: boolean, onHide: () => void) {
    return html`<esphome-web-install-rtl-ambz-dialog
      ?open=${open}
      @after-hide=${onHide}
    ></esphome-web-install-rtl-ambz-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-rtl-ambz-card": ESPHomeWebRtlAmbzCard;
  }
}
