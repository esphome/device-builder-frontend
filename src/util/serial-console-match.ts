// Espressif's native USB vendor id — the on-chip USB-Serial-JTAG / CDC
// device (C3/S2/S3/C6/... dev boards flashed over their native port).
const ESPRESSIF_USB_VID = 0x303a;

const USB_CONSOLE_INTERFACES = new Set(["USB_CDC", "USB_SERIAL_JTAG"]);

/**
 * Whether a granted Web Serial port provably cannot carry the device's log
 * console: the logger outputs on the chip's native USB while the port is an
 * external UART bridge, or the reverse. Unknown interface means false —
 * the quiet-serial watchdog stays the backstop.
 */
export function serialPortCannotCarryConsole(
  loggerInterface: string | null | undefined,
  port: SerialPort
): boolean {
  if (!loggerInterface) return false;
  const usbConsole = USB_CONSOLE_INTERFACES.has(loggerInterface);
  const nativePort = port.getInfo().usbVendorId === ESPRESSIF_USB_VID;
  return nativePort ? !usbConsole : usbConsole;
}
