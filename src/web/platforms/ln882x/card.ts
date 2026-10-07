import { LN882X_SERIAL_LOGS } from "../../../platforms/ln882x/index.js";
import type { LibreTinyCard } from "../../dashboard/libretiny-card-element.js";
import { LN_INSTALL } from "./install.js";

/**
 * LN882H: install through the chip's UART downloader, and logs. The engine
 * resets a board whose adapter's lines reach CEN and BOOT; else the dialog
 * shows the BOOT guide while the engine keeps polling.
 */
export const LN_CARD: LibreTinyCard = {
  copy: {
    title: "web.ln.title",
    hint: "web.ln.connect_hint",
    logs: "web.ln.logs",
  },
  logs: LN882X_SERIAL_LOGS,
  install: LN_INSTALL,
};
