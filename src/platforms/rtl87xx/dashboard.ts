/** The Device Builder's RTL8720C support: the ROM downloader over the board's serial adapter. */
import type { PlatformSupport } from "../platform-support.js";
import { rtlAmbz2Install } from "./ambz2-install.js";
import { isRtl87xxPlatform } from "./rtl87xx-platform.js";

export * from "./ambz2-install.js";

export const rtl87xxPlatform: PlatformSupport = {
  id: "rtl87xx",
  matches: isRtl87xxPlatform,
  install: rtlAmbz2Install,
};
