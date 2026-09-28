import { customElement } from "lit/decorators.js";

import { UartInstallDialog } from "../../install/uart-install-dialog.js";
import { RTL_INSTALL } from "./install.js";

/**
 * RTL8720C (AmebaZ2) install through the ROM downloader. The engine resets
 * the board into download mode over DTR/RTS where the adapter wires them;
 * else the dialog shows the strap guide while the engine keeps polling the
 * ROM.
 */
@customElement("esphome-web-install-rtl-dialog")
export class ESPHomeWebInstallRtlDialog extends UartInstallDialog {
  protected readonly install = RTL_INSTALL;
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-web-install-rtl-dialog": ESPHomeWebInstallRtlDialog;
  }
}
