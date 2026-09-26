/** RP2040 / RP2350 (ESPHome platform ``rp2``). Fail-closed on empty / unknown. */
export function isRp2Platform(targetPlatform: string | null | undefined): boolean {
  return (targetPlatform ?? "").toLowerCase().startsWith("rp2");
}
