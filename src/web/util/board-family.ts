import { ESPRESSIF_USB_VID } from "../../util/web-serial.js";
import { isRp2CdcPort } from "../../util/web-usb.js";
import type { WebMode } from "../web-mode.js";

// An nRF52 running ESPHome is a Zephyr USB device (ESPHome's only Zephyr
// platform), and Nordic's own id is nRF52 outright. Adafruit and Seeed also
// ship RP2040 / ESP32-S3 / SAMD boards under their vendor ids, so only their
// known nRF52840 products count (the bootloader's ids, and the application
// ids other firmwares use).
const ZEPHYR_USB_VID = 0x2fe3;
const NORDIC_USB_VID = 0x1915;
const NRF52_USB_IDS = new Set([
  // Adafruit: Feather nRF52840 Express, Feather nRF52840 Sense, ItsyBitsy
  // nRF52840, CLUE, Circuit Playground Bluefruit, LED Glasses driver.
  0x239a_8029, 0x239a_0029, 0x239a_8087, 0x239a_0087, 0x239a_8051, 0x239a_0051,
  0x239a_8071, 0x239a_0071, 0x239a_8045, 0x239a_0045, 0x239a_810d, 0x239a_010d,
  // Seeed: XIAO nRF52840 and XIAO nRF52840 Sense.
  0x2886_8044, 0x2886_0044, 0x2886_8045, 0x2886_0045,
]);

function isNrf52Port(port: SerialPort): boolean {
  const { usbVendorId, usbProductId } = port.getInfo();
  if (usbVendorId === ZEPHYR_USB_VID || usbVendorId === NORDIC_USB_VID) return true;
  if (usbVendorId === undefined || usbProductId === undefined) return false;
  return NRF52_USB_IDS.has(usbVendorId * 0x1_0000 + usbProductId);
}

/**
 * The site flow a Web Serial port's USB ids point at: a Pico's own CDC
 * console, a known nRF52 board, or an Espressif native-USB device. ``null``
 * when the ids say nothing certain: a dedicated UART bridge (CH340, CP210x)
 * sits in front of an ESP as readily as an RTL8720C, so it never counts, nor
 * does a debug probe, an unknown board or a non-USB port.
 */
export function boardFamilyOfPort(port: SerialPort): WebMode | null {
  if (isRp2CdcPort(port)) return "pico";
  if (isNrf52Port(port)) return "nrf";
  const { usbVendorId } = port.getInfo();
  return usbVendorId === ESPRESSIF_USB_VID ? "esp" : null;
}
