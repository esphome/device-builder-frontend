/** The Device Builder's Pico support: BOOTSEL, then PICOBOOT or a UF2 download, and logs. */
import type { PlatformSupport } from "../platform-support.js";
import { picoResetFailureKey, rebootPico } from "./rp2-logs-reset.js";
import { isRp2Platform } from "./rp2-platform.js";
import { rp2Uf2Install } from "./uf2-install.js";
import { isRp2CdcPort, isWebUsbSupported } from "./web-usb.js";

export * from "./uf2-install.js";

export const rp2Platform: PlatformSupport = {
  id: "rp2",
  matches: isRp2Platform,
  install: rp2Uf2Install,
  logs: {
    serial: {
      // The Pico's CDC has no reset line to pulse; Reset Device reboots it
      // over WebUSB instead, and only through its own CDC, not a UART bridge
      // on its console pins.
      pulseResets: false,
      releasesLinesAfterOpen: false,
      // arduino-pico's CDC only transmits while DTR is asserted.
      keepLinesOnReopen: true,
      reset: {
        available: isWebUsbSupported,
        supports: isRp2CdcPort,
        reboot: rebootPico,
        failureKey: picoResetFailureKey,
      },
    },
  },
};
