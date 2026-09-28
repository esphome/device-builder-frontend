import { customElement } from "lit/decorators.js";

import { LibreTinyInstallDialog } from "../../install/libretiny-install-dialog.js";
import { BK_INSTALL } from "./install.js";

/**
 * Beken BK72xx install through the chip's UART downloader. A chip that
 * runs ESPHome enters it by itself, and the engine resets one whose
 * adapter's lines reach it; else the dialog shows the reset guide while the
 * engine keeps polling.
 */
@customElement("esphome-web-install-bk-dialog")
export class ESPHomeWebInstallBkDialog extends LibreTinyInstallDialog {
  protected readonly install = BK_INSTALL;
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-bk-dialog": ESPHomeWebInstallBkDialog;
  }
}
