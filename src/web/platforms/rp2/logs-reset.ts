import {
  isWebUsbSupported,
  picoResetFailureKey,
  rebootPico,
} from "../../../platforms/rp2/index.js";
import type { WebSerialReset } from "../../logs/serial-reset.js";

/**
 * The Pico's Reset Device: the BOOTSEL touch plus a PICOBOOT reboot (see
 * rp2-logs-reset.ts). Its CDC port re-enumerates, so the logs drop the stream
 * and resume it, reacquiring the port. The reboot goes over WebUSB, so the
 * button hides where that is missing.
 */
export const PICO_RESET: WebSerialReset = {
  available: isWebUsbSupported,
  dropsStream: true,
  run: async (port, cancelled) => {
    await rebootPico(port, cancelled);
  },
  failureKey: (err) => picoResetFailureKey(err, "web.logs.reset_failed"),
};
