import { customElement } from "lit/decorators.js";

import type { RtlImage } from "../../../platforms/rtl87xx/index.js";
import { LibreTinyInstallDialog } from "../../install/libretiny-install-dialog.js";
import { RTL87XX_INSTALL } from "./install.js";

/** RTL87xx install through the ROM downloader of the chip the UF2 was built for. */
@customElement("esphome-web-install-rtl-dialog")
export class ESPHomeWebInstallRtlDialog extends LibreTinyInstallDialog<RtlImage> {
  protected readonly install = RTL87XX_INSTALL;
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-rtl-dialog": ESPHomeWebInstallRtlDialog;
  }
}
