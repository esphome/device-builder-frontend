import { BK72XX_SERIAL_LOGS } from "../../../platforms/bk72xx/index.js";
import type { LibreTinyCard } from "../../dashboard/libretiny-card-element.js";
import { BK_INSTALL } from "./install.js";

/**
 * Beken BK72xx: install through the chip's UART downloader, and logs. A chip
 * that runs ESPHome enters the downloader by itself, and the engine resets
 * one whose adapter's lines reach it; else the dialog shows the reset guide
 * while the engine keeps polling.
 */
export const BK_CARD: LibreTinyCard = {
  copy: {
    title: "web.bk.title",
    hint: "web.bk.connect_hint",
    logs: "web.bk.logs",
  },
  logs: BK72XX_SERIAL_LOGS,
  install: BK_INSTALL,
};
