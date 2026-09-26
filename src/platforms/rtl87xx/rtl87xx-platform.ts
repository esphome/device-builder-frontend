/** Realtek AmebaZ / AmebaZ2 (ESPHome platform ``rtl87xx``). Fail-closed on empty / unknown. */
export function isRtl87xxPlatform(targetPlatform: string | null | undefined): boolean {
  return (targetPlatform ?? "").toLowerCase().startsWith("rtl87xx");
}
