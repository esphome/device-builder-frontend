/** The Device Builder's nRF52 support: Nordic legacy DFU over the bootloader's CDC, and logs. */
import type { PlatformSupport } from "../platform-support.js";
import { nrf52Logs } from "./dashboard-logs.js";
import { nrfDfuInstall } from "./dfu-install.js";
import { isNrfPlatform } from "./nrf-platform.js";

export * from "./dashboard-logs.js";
export * from "./dfu-install.js";

export const nrf52Platform: PlatformSupport = {
  id: "nrf52",
  matches: isNrfPlatform,
  install: nrfDfuInstall,
  logs: nrf52Logs,
};
