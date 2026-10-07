import { BK72XX_SERIAL_LOGS } from "../../../platforms/bk72xx/index.js";
import type { LibreTinyCard } from "../../dashboard/libretiny-card-element.js";
import { BK_INSTALL } from "./install.js";

/** Beken BK72xx: install through the chip's UART downloader, and logs. */
export const BK_CARD: LibreTinyCard = {
  copy: {
    title: "web.bk.title",
    hint: "web.bk.connect_hint",
    logs: "web.bk.logs",
  },
  logs: BK72XX_SERIAL_LOGS,
  install: BK_INSTALL,
};
