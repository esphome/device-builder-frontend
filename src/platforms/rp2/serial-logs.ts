import type { SerialLogsPolicy } from "../serial-logs.js";
import { picoResetFailureKey, rebootPico } from "./rp2-logs-reset.js";
import { isRp2CdcPort, isWebUsbSupported } from "./web-usb.js";

/**
 * The Pico's CDC has no reset line to pulse: Reset device reboots it over
 * WebUSB instead, and only through its own CDC, not a UART bridge on its
 * console pins. A reopen keeps its DTR up (see ``releaseLinesAfterReopen``).
 */
export const RP2_SERIAL_LOGS: SerialLogsPolicy = {
  reset: {
    available: isWebUsbSupported,
    supports: isRp2CdcPort,
    reboot: rebootPico,
    failureKey: picoResetFailureKey,
  },
};
