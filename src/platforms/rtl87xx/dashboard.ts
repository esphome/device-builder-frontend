/** The Device Builder's RTL8720C and RTL8710B support: each ROM downloader over the board's serial adapter, and logs. */
import type { PlatformSupport } from "../platform-support.js";
import { rtlAmbzInstall } from "./ambz-install.js";
import { rtlAmbz2Install } from "./ambz2-install.js";
import { isRtl87xxPlatform } from "./rtl87xx-platform.js";
import { RTL87XX_SERIAL_LOGS } from "./serial-logs.js";

export * from "./ambz-install.js";
export * from "./ambz2-install.js";

export const rtl87xxPlatform: PlatformSupport = {
  id: "rtl87xx",
  matches: isRtl87xxPlatform,
  installs: [rtlAmbz2Install, rtlAmbzInstall],
  logs: { serial: RTL87XX_SERIAL_LOGS },
};
