import type { LocalizeFunc } from "../common/localize.js";
import { isEspressifUsbJtagPort } from "./web-serial.js";

// Vendors that make dedicated USB-UART bridge chips and nothing that
// enumerates as a device's native USB console. A port from one of these can
// only be wired to external UART pins. Mirrors the backend's picker-hint
// taxonomy in controllers/config/serial_ports.py (_BRIDGE_VIDS) - keep the
// two sets in lockstep.
const UART_BRIDGE_VENDOR_IDS = new Set([
  0x1a86, // WCH (CH340 / CH9102)
  0x10c4, // Silicon Labs (CP210x)
  0x0403, // FTDI
  0x067b, // Prolific (PL2303)
]);

// Spellings come from the backend's logger_interface_values vocabulary
// (platform_capabilities.index.json, snapshotted from esphome's logger) -
// keep in lockstep.
const USB_CONSOLE_INTERFACES = new Set(["USB_CDC", "USB_SERIAL_JTAG"]);

// UART0 / UART1 / UART2 / UART0_SWAP. Anything matching neither family is
// an interface this code doesn't know - fail open.
const UART_CONSOLE_RE = /^UART\d/;

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
  if (USB_CONSOLE_INTERFACES.has(loggerInterface)) {
    // A dedicated bridge chip can't be the chip's own USB device. An
    // unknown or absent vendor could be a native CDC console (RP2040's
    // 0x2e8a, nRF52) - assume it works.
    const { usbVendorId } = port.getInfo();
    return usbVendorId !== undefined && UART_BRIDGE_VENDOR_IDS.has(usbVendorId);
  }
  if (!UART_CONSOLE_RE.test(loggerInterface)) return false;
  // UART-family console: only the on-chip USB-Serial-JTAG device provably
  // can't carry it; any other port might be wired to the UART pins.
  return isEspressifUsbJtagPort(port);
}

/**
 * Mismatch verdict + localized notice when the port provably can't carry
 * the console, else null. The single home for the decision and its message;
 * an object so callers gate on the verdict, never on the copy's truthiness.
 */
export function serialConsoleMismatch(
  loggerInterface: string | null | undefined,
  port: SerialPort,
  localize: LocalizeFunc
): { message: string } | null {
  if (!serialPortCannotCarryConsole(loggerInterface, port)) return null;
  return {
    message: localize("dashboard.logs_serial_wrong_port_fallback", {
      interface: loggerInterface ?? "",
    }),
  };
}
