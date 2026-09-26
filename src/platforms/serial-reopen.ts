/**
 * The one line rule both apps apply after reopening a logs port, kept out of
 * ``serial-logs.ts`` so the policy module names no platform.
 */
import { releaseControlLines } from "../util/serial-control-lines.js";
import { isUartBridgePort } from "../util/uart-bridge-ids.js";
import { ESPRESSIF_USB_VID } from "./esp/index.js";
import { isRp2Platform } from "./rp2/rp2-platform.js";
import type { SerialLogsPolicy } from "./serial-logs.js";

/**
 * A reopen asserts DTR and RTS. A policy that releases them after an open
 * (the RTL8720C's strap and reset lines) releases them after a reopen too,
 * whatever bridge the kit sits behind. Otherwise drop them where an
 * auto-reset circuit reads them (a UART bridge, an Espressif USB-JTAG), and
 * leave them up on an RP2 board, whose arduino-pico CDC only transmits while
 * DTR is asserted.
 *
 * The Device Builder knows the device's platform and passes it; arduino-pico
 * ships a third of its boards under their makers' USB ids, so the port alone
 * can't tell an RP2 apart. Without a platform (web.esphome.io, where the ESP
 * card can reach any board) the rule is by port: only a bridge or an
 * Espressif chip gets the lines dropped, any other native CDC keeps them.
 */
export async function releaseLinesAfterReopen(
  port: SerialPort,
  policy: Pick<SerialLogsPolicy, "releaseLinesAfterOpen">,
  targetPlatform?: string | null
): Promise<void> {
  if (!policy.releaseLinesAfterOpen && keepsLinesOnReopen(port, targetPlatform)) return;
  await releaseControlLines(port);
}

function keepsLinesOnReopen(port: SerialPort, targetPlatform?: string | null): boolean {
  if (targetPlatform != null) return isRp2Platform(targetPlatform);
  return !isUartBridgePort(port) && port.getInfo().usbVendorId !== ESPRESSIF_USB_VID;
}
