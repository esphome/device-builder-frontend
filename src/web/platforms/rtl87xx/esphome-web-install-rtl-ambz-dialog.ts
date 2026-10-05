import { customElement } from "lit/decorators.js";

import type { AmbzImage } from "../../../platforms/rtl87xx/index.js";
import { LibreTinyInstallDialog } from "../../install/libretiny-install-dialog.js";
import { RTL_AMBZ_INSTALL } from "./ambz-install.js";

/**
 * RTL8710B (AmebaZ) install through the ROM downloader. The engine pulses RTS
 * in case it drives the reset; else the dialog shows the TX2 strap guide while
 * the engine keeps polling the ROM.
 */
@customElement("esphome-web-install-rtl-ambz-dialog")
export class ESPHomeWebInstallRtlAmbzDialog extends LibreTinyInstallDialog<AmbzImage> {
  protected readonly install = RTL_AMBZ_INSTALL;
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-rtl-ambz-dialog": ESPHomeWebInstallRtlAmbzDialog;
  }
}
