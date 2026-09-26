/**
 * The one line rule both apps apply after reopening a logs port, kept out of
 * ``serial-logs.ts`` so the policy module names no platform.
 */
import { releaseControlLines } from "../util/serial-control-lines.js";
import { isUartBridgePort } from "../util/uart-bridge-ids.js";
import { ESPRESSIF_USB_VID } from "./esp/index.js";
import { isRp2Platform } from "./rp2/rp2-platform.js";

/**
 * A reopen asserts DTR and RTS. Drop them where an auto-reset circuit reads
 * them (a UART bridge, an Espressif USB-JTAG), and leave them up on an RP2
 * board, whose arduino-pico CDC only transmits while DTR is asserted.
 *
 * The Device Builder knows the device's platform and passes it; arduino-pico
 * ships a third of its boards under their makers' USB ids, so the port alone
 * can't tell an RP2 apart. Without a platform (web.esphome.io, where the ESP
 * card can reach any board) the rule is by port: only a bridge or an
 * Espressif chip gets the lines dropped, any other native CDC keeps them.
 */
export async function releaseLinesAfterReopen(
  port: SerialPort,
  targetPlatform?: string | null
): Promise<void> {
  const keep =
    targetPlatform != null
      ? isRp2Platform(targetPlatform)
      : !isUartBridgePort(port) && port.getInfo().usbVendorId !== ESPRESSIF_USB_VID;
  if (!keep) await releaseControlLines(port);
}
