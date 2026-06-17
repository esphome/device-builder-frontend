// Baud to open the UART log stream at, or null when the device disabled
// serial logging (logger baud_rate 0). A null / undefined wire value means
// the YAML set no baud, so fall back to ESPHome's 115200 default.
//
// Pure helper kept out of web-serial.ts so non-flashing callers (and Node
// tests) don't pull in its esptool-js dependency.
export function resolveLogBaudRate(
  loggerBaudRate: number | null | undefined
): number | null {
  if (loggerBaudRate === 0) return null;
  return loggerBaudRate ?? 115200;
}
