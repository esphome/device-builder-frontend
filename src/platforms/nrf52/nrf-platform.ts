/** nRF52 (Adafruit bootloader / Nordic Legacy DFU). Fail-closed on empty / unknown. */
export function isNrfPlatform(targetPlatform: string | null | undefined): boolean {
  return (targetPlatform ?? "").toLowerCase().startsWith("nrf52");
}
