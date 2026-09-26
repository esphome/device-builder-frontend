import type { SerialLogsPolicy } from "../serial-logs.js";
import { nrfResetFailureKey, rebootNrf } from "./nrf-logs-reset.js";
import { isNrfAppCdcPort } from "./nrf-platform.js";

/**
 * The DFU-capable CDC has no reset line to pulse: Reset device reboots
 * ESPHome through the 2001-baud touch instead, on its own CDC only.
 */
export const NRF52_SERIAL_LOGS: SerialLogsPolicy = {
  reset: {
    available: () => true,
    supports: isNrfAppCdcPort,
    reboot: rebootNrf,
    failureKey: nrfResetFailureKey,
  },
};
