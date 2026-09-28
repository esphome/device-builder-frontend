import type { SerialLogsPolicy } from "../serial-logs.js";

/**
 * Chromium asserts DTR and RTS on open. On an adapter whose RTS reaches
 * CEN that holds the chip in reset, so both are released. No Reset device:
 * most modules sit on an adapter wired to TX, RX and GND alone.
 */
export const BK72XX_SERIAL_LOGS: SerialLogsPolicy = {
  releaseLinesAfterOpen: true,
};
