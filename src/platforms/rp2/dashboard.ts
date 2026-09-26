/** The Device Builder's Pico support: BOOTSEL, then PICOBOOT or a UF2 download, and logs. */
import type { PlatformSupport } from "../platform-support.js";
import { rp2Logs } from "./dashboard-logs.js";
import { isRp2Platform } from "./rp2-platform.js";
import { rp2Uf2Install } from "./uf2-install.js";

export * from "./dashboard-logs.js";
export * from "./uf2-install.js";

export const rp2Platform: PlatformSupport = {
  id: "rp2",
  matches: isRp2Platform,
  install: rp2Uf2Install,
  logs: rp2Logs,
};
