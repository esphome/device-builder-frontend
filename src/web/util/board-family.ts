import { isUartBridgePort } from "../../util/serial-console-match.js";
import { ESPRESSIF_USB_VID } from "../../util/web-serial.js";
import { isRp2CdcPort } from "../../util/web-usb.js";
import type { WebMode } from "../web-mode.js";

// Vendors whose native-USB boards are nRF52 boards in the ESPHome world:
// Adafruit (Feather / ItsyBitsy / CLUE nRF52840, also its bootloader),
// Nordic's own id (the nRF52840 dongle) and Seeed (the XIAO nRF52840).
const NRF52_USB_VIDS = new Set([0x239a, 0x1915, 0x2886]);

/**
 * The site flow a Web Serial port's USB ids point at: a Pico's own CDC
 * console, a known nRF52 vendor, or an Espressif native-USB device / a
 * dedicated UART bridge for the esptool path. ``null`` when the ids say
 * nothing certain (a debug probe, an unknown vendor, a non-USB port).
 */
export function boardFamilyOfPort(port: SerialPort): WebMode | null {
  if (isRp2CdcPort(port)) return "pico";
  const { usbVendorId } = port.getInfo();
  if (usbVendorId === undefined) return null;
  if (NRF52_USB_VIDS.has(usbVendorId)) return "nrf";
  if (usbVendorId === ESPRESSIF_USB_VID || isUartBridgePort(port)) return "esp";
  return null;
}
