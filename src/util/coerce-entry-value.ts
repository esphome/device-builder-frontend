import type { ConfigEntry } from "../api/types/config-entries.js";
import { ConfigEntryType } from "../api/types/config-entries.js";
import { coerceIntFieldValue } from "./int-input.js";

/**
 * Coerce a control's string value back to the entry's declared numeric
 * type before emitting. A wa-select / combo box always hands back a
 * string, but an INTEGER/FLOAT field's YAML must be a number or downstream
 * validation (and the backend's locked-value compare) rejects it. INTEGER
 * goes through ``coerceIntFieldValue`` so a >2^53 decimal stays a string
 * (64-bit precision, #378/#944) and a ``0x…`` literal isn't truncated.
 * Non-numeric entries, an empty string, and unparseable input pass through
 * unchanged so the inline validator can flag them.
 */
export function coerceValueToEntryType(entry: ConfigEntry, raw: string): string | number {
  if (entry.type === ConfigEntryType.INTEGER) return coerceIntFieldValue(raw);
  if (entry.type !== ConfigEntryType.FLOAT || raw === "") return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}
