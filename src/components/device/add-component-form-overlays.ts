import type { ConfigEntry } from "../../api/types/config-entries.js";
import { ConfigEntryType } from "../../api/types/config-entries.js";

/** Mark `extra` keys required on the matching entries (require_tx -> tx_pin). */
export function overlayRequired(
  entries: ConfigEntry[],
  extra: string[] | null
): ConfigEntry[] {
  if (!extra?.length) return entries;
  const keys = new Set(extra);
  return entries.map((e) =>
    keys.has(e.key) && !e.required ? { ...e, required: true } : e
  );
}

/**
 * Narrow an entry's dropdown to a requester-imposed choice set, default-first.
 *
 * Existing catalog labels survive (only synthesized when the entry had none),
 * `allow_custom_value` is untouched so a baud combo box stays typeable, the
 * default is type-coerced for STRING entries, and `multi_value` fields (not a
 * select) are skipped.
 */
export function overlayOptions(
  entries: ConfigEntry[],
  overrides: Record<string, (string | number)[]> | null
): ConfigEntry[] {
  if (!overrides || Object.keys(overrides).length === 0) return entries;
  return entries.map((e) => {
    const choices = overrides[e.key];
    if (!choices?.length || e.multi_value) return e;
    const byValue = new Map((e.options ?? []).map((o) => [o.value, o]));
    return {
      ...e,
      options: choices.map(
        (v) => byValue.get(String(v)) ?? { label: String(v), value: String(v) }
      ),
      default_value: e.type === ConfigEntryType.STRING ? String(choices[0]) : choices[0],
    };
  });
}
