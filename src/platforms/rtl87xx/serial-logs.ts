import type { SerialLogsPolicy } from "../serial-logs.js";

/**
 * Chromium asserts DTR and RTS on open. An RTL8720C kit wires RTS to CEN
 * (held, the chip sits in reset) and DTR to PA00, the download strap (a reset
 * with it held lands in the ROM downloader), so both are released and the
 * board boots into the firmware. RTS still resets it on demand.
 */
export const RTL87XX_SERIAL_LOGS: SerialLogsPolicy = {
  reset: "rts-pulse",
  releaseLinesAfterOpen: true,
};
