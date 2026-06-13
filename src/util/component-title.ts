/** Trim a core catalog title's redundant tail (" Component" / esphome's
 *  "ESPHome Core Configuration") so rows stay scannable. Core-only — many
 *  non-core titles legitimately end in " Component" (e.g. "Copy Component"). */
export function stripRedundantComponentSuffix(name: string): string {
  return name.replace(/ (Component|Configuration)$/, "") || name;
}
