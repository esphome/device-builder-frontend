import type { SerialLogsPolicy } from "../serial-logs.js";

/**
 * Chromium asserts DTR and RTS on open. On an adapter whose RTS reaches
 * CEN that holds the chip in reset, so both are released. RTS still resets
 * it on demand; on an adapter wired to TX, RX and GND alone the pulse does
 * nothing.
 */
export const BK72XX_SERIAL_LOGS: SerialLogsPolicy = {
  reset: "rts-pulse",
  releaseLinesAfterOpen: true,
};
