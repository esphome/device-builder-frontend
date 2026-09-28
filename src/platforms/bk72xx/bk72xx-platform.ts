/** Beken BK72xx (ESPHome platform ``bk72xx``). Fail-closed on empty / unknown. */
export function isBk72xxPlatform(targetPlatform: string | null | undefined): boolean {
  return (targetPlatform ?? "").toLowerCase().startsWith("bk72xx");
}
