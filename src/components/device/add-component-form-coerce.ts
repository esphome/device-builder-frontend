import type { ConfigEntry } from "../../api/types.js";
import { ConfigEntryType } from "../../api/types.js";
import { parseYamlBoolean } from "../../util/yaml-serialize.js";

/**
 * Coerce raw form values for the WS payload: numbers / booleans to
 * their proper types so the backend sees `5`, not `"5"`. Hex-display
 * integers stay strings; the renderer's canonical `"0x..."` survives
 * to YAML and `cv.hex_int` accepts both forms on parse.
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
      const childValues =
        raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
      const sub = coerceFields(entry.config_entries ?? [], childValues);
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
      const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
      if (!Number.isNaN(n)) out[entry.key] = n;
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
