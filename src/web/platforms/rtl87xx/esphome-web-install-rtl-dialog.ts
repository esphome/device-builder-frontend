import { customElement } from "lit/decorators.js";

import { LibreTinyInstallDialog } from "../../install/libretiny-install-dialog.js";
import { RTL87XX_INSTALL, type RtlImage } from "./install.js";

/**
 * RTL87xx install through the ROM downloader of the chip the UF2 was built
 * for (RTL8720C or RTL8710B). The engine resets the board where the adapter's
 * lines allow it; else the dialog shows that chip's strap guide while the
 * engine keeps polling the ROM.
 */
@customElement("esphome-web-install-rtl-dialog")
export class ESPHomeWebInstallRtlDialog extends LibreTinyInstallDialog<RtlImage> {
  protected readonly install = RTL87XX_INSTALL;
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-rtl-dialog": ESPHomeWebInstallRtlDialog;
  }
}
