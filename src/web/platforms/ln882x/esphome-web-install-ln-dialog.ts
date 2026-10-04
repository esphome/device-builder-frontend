import { customElement } from "lit/decorators.js";

import { LibreTinyInstallDialog } from "../../install/libretiny-install-dialog.js";
import { LN_INSTALL } from "./install.js";

/**
 * LN882H install through the chip's UART downloader. The engine resets a
 * board whose adapter's lines reach CEN and BOOT; else the dialog shows the
 * BOOT guide while the engine keeps polling.
 */
@customElement("esphome-web-install-ln-dialog")
export class ESPHomeWebInstallLnDialog extends LibreTinyInstallDialog {
  protected readonly install = LN_INSTALL;
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-ln-dialog": ESPHomeWebInstallLnDialog;
  }
}
