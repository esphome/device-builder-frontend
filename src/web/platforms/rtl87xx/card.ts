import { RTL87XX_SERIAL_LOGS } from "../../../platforms/rtl87xx/index.js";
import type { LibreTinyCard } from "../../dashboard/libretiny-card-element.js";
import { RTL87XX_INSTALL } from "./install.js";

/** RTL87xx: install through the ROM downloader of the chip the UF2 was built for, and logs. */
export const RTL_CARD: LibreTinyCard = {
  copy: {
    title: "web.rtl.title",
    hint: "web.rtl.connect_hint",
    logs: "web.rtl.logs",
  },
  logs: RTL87XX_SERIAL_LOGS,
  install: RTL87XX_INSTALL,
};
