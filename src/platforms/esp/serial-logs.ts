import type { SerialLogsPolicy } from "../serial-logs.js";

/** ESP boards reset through the auto-reset circuit on their UART bridge or USB CDC. */
export const ESP_SERIAL_LOGS: SerialLogsPolicy = { reset: "rts-pulse" };
