// Vendors that make dedicated USB-UART bridge chips and nothing that
// enumerates as a device's native USB console. A port from one of these can
// only be wired to external UART pins.
const UART_BRIDGE_VENDOR_IDS = new Set([
  0x1a86, // WCH (CH340 / CH9102)
  0x10c4, // Silicon Labs (CP210x)
  0x0403, // FTDI
  0x067b, // Prolific (PL2303)
]);

// The on-chip USB-Serial-JTAG device every native-USB ESP32 variant
// enumerates as. The product id matters: Espressif's 0x303a also covers the
// ESP-USB-Bridge (0x1002), which IS a UART bridge.
const ESPRESSIF_USB_JTAG_VID = 0x303a;
const ESPRESSIF_USB_JTAG_PID = 0x1001;

const USB_CONSOLE_INTERFACES = new Set(["USB_CDC", "USB_SERIAL_JTAG"]);

/**
 * Whether a granted Web Serial port provably cannot carry the device's log
 * console. Deliberately fails open: a mismatch is claimed only when the
 * port's USB identity makes it certain (a dedicated bridge chip watching a
 * native-USB console, or the on-chip USB-Serial-JTAG device watching a UART
 * console); anything uncertain returns false and serial is assumed to work,
 * with the quiet-serial watchdog as the backstop.
 */
export function serialPortCannotCarryConsole(
  loggerInterface: string | null | undefined,
  port: SerialPort
): boolean {
  if (!loggerInterface) return false;
  const { usbVendorId, usbProductId } = port.getInfo();
  if (USB_CONSOLE_INTERFACES.has(loggerInterface)) {
    // A dedicated bridge chip can't be the chip's own USB device. An
    // unknown or absent vendor could be a native CDC console (RP2040's
    // 0x2e8a, nRF52) — assume it works.
    return usbVendorId !== undefined && UART_BRIDGE_VENDOR_IDS.has(usbVendorId);
  }
  // UART-family console: only the on-chip USB-Serial-JTAG device provably
  // can't carry it; any other port might be wired to the UART pins.
  return (
    usbVendorId === ESPRESSIF_USB_JTAG_VID && usbProductId === ESPRESSIF_USB_JTAG_PID
  );
}
