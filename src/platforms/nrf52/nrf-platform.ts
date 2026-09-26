/** ESPHome on an nRF52 is a Zephyr USB device (its only Zephyr platform). */
export const ZEPHYR_USB_VID = 0x2fe3;
// ESPHome leaves Zephyr's default USB product id in place.
const ESPHOME_ZEPHYR_USB_PID = 0x0100;

/**
 * ESPHome's own CDC on an nRF52 (Zephyr's default ids), as opposed to a UART
 * bridge on its console pins or another Zephyr device.
 */
export const isNrfAppCdcPort = (port: SerialPort): boolean => {
  const { usbVendorId, usbProductId } = port.getInfo();
  return usbVendorId === ZEPHYR_USB_VID && usbProductId === ESPHOME_ZEPHYR_USB_PID;
};

// Nordic's own id is nRF52 outright. Adafruit and Seeed also ship RP2040 /
// ESP32-S3 / SAMD boards under their vendor ids, so only their known
// nRF52840 products count (the bootloader's ids, and the application ids
// other firmwares use).
const NORDIC_USB_VID = 0x1915;
const NRF52_USB_IDS = new Set([
  // Adafruit: Feather nRF52840 Express, Feather nRF52840 Sense, ItsyBitsy
  // nRF52840, CLUE, Circuit Playground Bluefruit, LED Glasses driver.
  0x239a_8029, 0x239a_0029, 0x239a_8087, 0x239a_0087, 0x239a_8051, 0x239a_0051,
  0x239a_8071, 0x239a_0071, 0x239a_8045, 0x239a_0045, 0x239a_810d, 0x239a_010d,
  // Seeed: XIAO nRF52840 and XIAO nRF52840 Sense.
  0x2886_8044, 0x2886_0044, 0x2886_8045, 0x2886_0045,
]);

/**
 * A Web Serial port that is an nRF52 board: any Zephyr or Nordic device, or
 * a known nRF52840 product. Reset device narrows it to ESPHome's own ids
 * (``isNrfAppCdcPort``).
 */
export function isNrf52Port(port: SerialPort): boolean {
  const { usbVendorId, usbProductId } = port.getInfo();
  if (usbVendorId === ZEPHYR_USB_VID || usbVendorId === NORDIC_USB_VID) return true;
  if (usbVendorId === undefined || usbProductId === undefined) return false;
  return NRF52_USB_IDS.has(usbVendorId * 0x1_0000 + usbProductId);
}

/** nRF52 (Adafruit bootloader / Nordic Legacy DFU). Fail-closed on empty / unknown. */
export function isNrfPlatform(targetPlatform: string | null | undefined): boolean {
  return (targetPlatform ?? "").toLowerCase().startsWith("nrf52");
}
