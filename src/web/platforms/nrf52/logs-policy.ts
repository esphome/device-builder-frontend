import {
  isNrfAppCdcPort,
  nrfResetFailureKey,
  rebootNrf,
} from "../../../platforms/nrf52/index.js";
import type { WebLogsPolicy, WebSerialReset } from "../../logs/logs-policy.js";

/**
 * The nRF52's Reset device: ESPHome's 2001-baud touch (see
 * ``src/platforms/nrf52/nrf-logs-reset.ts``). Its CDC port re-enumerates, so
 * the logs drop the stream and resume it, reacquiring the port.
 */
export const NRF_RESET: WebSerialReset = {
  available: () => true,
  // Only ESPHome's own CDC reacts; the bootloader or other firmware would
  // just get a misleading "update ESPHome".
  supports: isNrfAppCdcPort,
  dropsStream: true,
  run: async (port, cancelled) => {
    await rebootNrf(port, cancelled);
  },
  failureKey: nrfResetFailureKey,
};

/** The nRF52's CDC has no reset line, and ignores the lines otherwise. */
export const NRF_LOGS: WebLogsPolicy = { reset: NRF_RESET };
