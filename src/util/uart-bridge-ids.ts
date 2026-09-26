// Vendors that make dedicated USB-UART bridge chips and nothing that
// enumerates as a device's native USB console. A port from one of these can
// only be wired to external UART pins. Mirrors the backend's picker-hint
// taxonomy in controllers/config/serial_ports.py (_BRIDGE_VIDS) - keep the
// two sets in lockstep.
export const UART_BRIDGE_VENDOR_IDS: ReadonlySet<number> = new Set([
  0x1a86, // WCH (CH340 / CH9102)
  0x10c4, // Silicon Labs (CP210x)
  0x0403, // FTDI
  0x067b, // Prolific (PL2303)
]);

/** A port on a dedicated USB-UART bridge chip, never a board's own console. */
export function isUartBridgePort(port: SerialPort): boolean {
  const vid = port.getInfo().usbVendorId;
  return vid !== undefined && UART_BRIDGE_VENDOR_IDS.has(vid);
}
