/**
 * The one line rule both apps apply after reopening a logs port, kept out of
 * ``serial-logs.ts`` so the policy module names no platform: it depends on
 * the port, not on which platform's flow reached it.
 */
import { releaseControlLines } from "../util/serial-control-lines.js";
import { isRp2CdcPort } from "./rp2/web-usb.js";

/**
 * A reopen asserts DTR and RTS: drop them, which a UART bridge's auto-reset
 * circuit needs, except on a Pico's own CDC, where arduino-pico only
 * transmits while DTR is asserted (whichever flow reached the port).
 */
export async function releaseLinesAfterReopen(port: SerialPort): Promise<void> {
  if (!isRp2CdcPort(port)) await releaseControlLines(port);
}
