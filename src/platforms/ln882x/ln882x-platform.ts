/** Lightning LN882x (ESPHome platform ``ln882x``). Fail-closed on empty / unknown. */
export function isLn882xPlatform(targetPlatform: string | null | undefined): boolean {
  return (targetPlatform ?? "").toLowerCase().startsWith("ln882x");
}
