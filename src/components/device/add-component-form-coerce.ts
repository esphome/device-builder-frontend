import type { ConfigEntry } from "../../api/types/config-entries.js";
import { ConfigEntryType } from "../../api/types/config-entries.js";
import { coerceIntFieldValue } from "../../util/int-input.js";
import { asMappingList, asRecord } from "../../util/nested-values.js";
import { parseYamlBoolean } from "../../util/yaml-serialize.js";

/**
 * Coerce raw form values for the WS payload: numbers / booleans to
 * their proper types so the backend sees `5`, not `"5"`. Decimal
 * integers become numbers; hex (`0x..`, including hex-display fields)
 * stays a verbatim string so `cv.int_` / `cv.hex_int` parse it rather
 * than `parseInt(..., 10)` silently truncating `0x1111` to `0`.
 */
export function coerceFields(
  entries: ConfigEntry[],
  values: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const entry of entries) {
    if (entry.hidden) continue;
    const raw = values[entry.key];

    if (entry.type === ConfigEntryType.NESTED) {
      const childEntries = entry.config_entries ?? [];
      // multi_value NESTED is a repeatable list of mappings; without
      // coercing each item the required field is dropped from the payload
      // and the backend rejects it.
      if (entry.multi_value) {
        const items = asMappingList(raw)
          .map((item) => coerceFields(childEntries, item))
          .filter((item) => Object.keys(item).length > 0);
        if (items.length > 0) out[entry.key] = items;
        continue;
      }
      const sub = coerceFields(childEntries, asRecord(raw));
      if (Object.keys(sub).length > 0) out[entry.key] = sub;
      continue;
    }

    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      if (raw.length === 0) continue;
      out[entry.key] = raw;
      continue;
    }
    if (raw === "") {
      if (entry.required) out[entry.key] = raw;
      continue;
    }

    if (entry.type === ConfigEntryType.INTEGER && entry.display_format !== "hex") {
      out[entry.key] = coerceIntFieldValue(raw);
    } else if (entry.type === ConfigEntryType.FLOAT) {
      const n = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
      if (!Number.isNaN(n)) out[entry.key] = n;
    } else if (entry.type === ConfigEntryType.BOOLEAN) {
      out[entry.key] = parseYamlBoolean(raw) === true;
    } else {
      out[entry.key] = raw;
    }
  }
  return out;
}
