import type { ConfigEntry } from "../api/types/config-entries.js";
import type { LocalizeFunc } from "../common/localize.js";

/**
 * Resolve the user-visible label for *entry* given a `localize`
 * function. Three-layer fallback:
 *
 * 1. `translation_key` resolved via `localize` (ignored when
 *    `localize` echoes the key back unchanged — the convention
 *    for "no translation registered").
 * 2. The catalog's English `entry.label`.
 * 3. The entry's `key`, prettified — `"update_interval"` →
 *    `"Update Interval"`.
 *
 * Kept in this side-effect-free util (no Lit / renderer deps) so
 * the value-seeding pipeline and the renderers can share the same
 * chain without dragging in DOM-dependent renderer modules.
 */
export function resolveEntryLabel(entry: ConfigEntry, localize: LocalizeFunc): string {
  if (entry.translation_key) {
    const params = (entry.translation_params || undefined) as
      Record<string, string | number> | undefined;
    const translated = localize(entry.translation_key, params);
    if (translated && translated !== entry.translation_key) return translated;
  }
  if (entry.label) return entry.label;
  return entry.key
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
