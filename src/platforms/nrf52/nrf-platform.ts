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

/** nRF52 (Adafruit bootloader / Nordic Legacy DFU). Fail-closed on empty / unknown. */
export function isNrfPlatform(targetPlatform: string | null | undefined): boolean {
  return (targetPlatform ?? "").toLowerCase().startsWith("nrf52");
}
