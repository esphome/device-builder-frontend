/**
 * Whether a target platform is an nRF52 device (Adafruit bootloader / Nordic
 * Legacy DFU). Fail-closed: empty / unknown returns false.
 */
export function isNrfPlatform(targetPlatform: string | null | undefined): boolean {
  return (targetPlatform ?? "").toLowerCase().startsWith("nrf52");
}
