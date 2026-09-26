/** The Device Builder's Pico support: BOOTSEL, then PICOBOOT or a UF2 download, and logs. */
import type { PlatformSupport } from "../platform-support.js";
import { isRp2Platform } from "./rp2-platform.js";
import { RP2_SERIAL_LOGS } from "./serial-logs.js";
import { rp2Uf2Install } from "./uf2-install.js";

export * from "./uf2-install.js";

export const rp2Platform: PlatformSupport = {
  id: "rp2",
  matches: isRp2Platform,
  install: rp2Uf2Install,
  logs: { serial: RP2_SERIAL_LOGS },
};
