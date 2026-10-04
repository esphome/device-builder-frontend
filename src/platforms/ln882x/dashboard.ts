/** The Device Builder's LN882H support: the chip's UART downloader over a serial adapter. */
import type { PlatformSupport } from "../platform-support.js";
import { ln882xInstall } from "./ln882x-install.js";
import { isLn882xPlatform } from "./ln882x-platform.js";

export * from "./ln882x-install.js";

export const ln882xPlatform: PlatformSupport = {
  id: "ln882x",
  matches: isLn882xPlatform,
  installs: [ln882xInstall],
};
