/** The Device Builder's BK72xx support: the chip's UART downloader over a serial adapter. */
import type { PlatformSupport } from "../platform-support.js";
import { bekenInstall } from "./beken-install.js";
import { isBk72xxPlatform } from "./bk72xx-platform.js";

export * from "./beken-install.js";

export const bk72xxPlatform: PlatformSupport = {
  id: "bk72xx",
  matches: isBk72xxPlatform,
  installs: [bekenInstall],
};
