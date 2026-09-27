/**
 * What a Web Serial port's USB ids say about the board behind it, for both
 * apps: the plug-in flow switch on web.esphome.io and the Device Builder's
 * board detection. The claims use disjoint vendor ids, so a port has at
 * most one family.
 */
import { isUartBridgePort } from "../util/uart-bridge-ids.js";
import { ESPRESSIF_USB_VID, isEspressifUsbBridgePort } from "./esp/esp-usb.js";
import { isNrf52Port } from "./nrf52/nrf-platform.js";
import { isRp2CdcPort } from "./rp2/web-usb.js";

/** A platform id a board's own USB ids name outright. */
export type PortFamily = "esp" | "rp2" | "nrf52";

/**
 * The family of a board's own USB console, or none for a UART bridge (which
 * can front anything), a port without USB ids, or a device we don't know.
 */
export function portFamily(port: SerialPort): PortFamily | undefined {
  if (port.getInfo().usbVendorId === ESPRESSIF_USB_VID) {
    return isEspressifUsbBridgePort(port) ? undefined : "esp";
  }
  if (isRp2CdcPort(port)) return "rp2";
  if (isNrf52Port(port)) return "nrf52";
  return undefined;
}

/**
 * Whether an ESP can be behind the port, so the ESP detect is worth running:
 * anything under Espressif's vendor id, a UART bridge, or a port with no USB
 * ids to go by.
 * Any other native-USB device is some other board, and esptool would sit on
 * its console waiting for a ROM loader that never answers (#1856).
 */
export function mayCarryEsp(port: SerialPort): boolean {
  const { usbVendorId, usbProductId } = port.getInfo();
  if (usbVendorId === undefined || usbProductId === undefined) return true;
  return usbVendorId === ESPRESSIF_USB_VID || isUartBridgePort(port);
}
