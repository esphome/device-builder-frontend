/** The Device Builder's RTL8720C support: the ROM downloader over the board's serial adapter, and logs. */
import type { PlatformSupport } from "../platform-support.js";
import { rtlAmbz2Install } from "./ambz2-install.js";
import { isRtl87xxPlatform } from "./rtl87xx-platform.js";

export * from "./ambz2-install.js";

export const rtl87xxPlatform: PlatformSupport = {
  id: "rtl87xx",
  matches: isRtl87xxPlatform,
  install: rtlAmbz2Install,
  logs: {
    // Chromium asserts DTR and RTS on open. An RTL8720C kit wires RTS to CEN
    // (held, the chip sits in reset) and DTR to PA00, the download strap (a
    // reset with it held lands in the ROM downloader), so both are released
    // and the board boots into the firmware. RTS still resets it on demand.
    serial: { pulseResets: true, releasesLinesAfterOpen: true },
  },
};
