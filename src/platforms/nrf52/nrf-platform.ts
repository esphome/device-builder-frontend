/** ESPHome on an nRF52 is a Zephyr USB device (its only Zephyr platform). */
export const ZEPHYR_USB_VID = 0x2fe3;

/** ESPHome's own CDC on an nRF52, as opposed to a UART bridge on its console pins. */
export const isNrfAppCdcPort = (port: SerialPort): boolean =>
  port.getInfo().usbVendorId === ZEPHYR_USB_VID;

/** nRF52 (Adafruit bootloader / Nordic Legacy DFU). Fail-closed on empty / unknown. */
export function isNrfPlatform(targetPlatform: string | null | undefined): boolean {
  return (targetPlatform ?? "").toLowerCase().startsWith("nrf52");
}
