/** The Device Builder's RTL8720C support: the ROM downloader over the board's serial adapter, and logs. */
import type { PlatformSupport } from "../platform-support.js";
import { rtlAmbz2Install } from "./ambz2-install.js";
import { isRtl87xxPlatform } from "./rtl87xx-platform.js";
import { RTL87XX_SERIAL_LOGS } from "./serial-logs.js";

export * from "./ambz2-install.js";

export const rtl87xxPlatform: PlatformSupport = {
  id: "rtl87xx",
  matches: isRtl87xxPlatform,
  install: rtlAmbz2Install,
  logs: { serial: RTL87XX_SERIAL_LOGS },
};
