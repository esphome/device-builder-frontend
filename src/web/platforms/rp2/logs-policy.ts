import {
  isWebUsbSupported,
  picoResetFailureKey,
  rebootPico,
} from "../../../platforms/rp2/index.js";
import type { WebLogsPolicy, WebSerialReset } from "../../logs/logs-policy.js";

/**
 * The Pico's Reset device: the BOOTSEL touch plus a PICOBOOT reboot (see
 * ``src/platforms/rp2/rp2-logs-reset.ts``). Its CDC port re-enumerates, so
 * the logs drop the stream and resume it, reacquiring the port. The reboot
 * goes over WebUSB, so the button hides where that is missing.
 */
export const PICO_RESET: WebSerialReset = {
  available: isWebUsbSupported,
  dropsStream: true,
  run: async (port, cancelled) => {
    await rebootPico(port, cancelled);
  },
  failureKey: (err) => picoResetFailureKey(err, "web.logs.reset_failed"),
};

/** The Pico's CDC has no reset line, and it only transmits while DTR is asserted. */
export const PICO_LOGS: WebLogsPolicy = { reset: PICO_RESET };
