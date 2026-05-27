import type { ConfigEntry } from "../../api/types.js";
import { ConfigEntryType } from "../../api/types.js";
import { parseYamlBoolean } from "../../util/yaml-serialize.js";

/**
 * Convert raw form values into the API payload. Drops empty strings
 * (unless required), keeps arrays as-is, recurses through NESTED
 * groups. Numeric / boolean entries coerce so the backend sees `5`,
 * not `"5"`; hex-display integers pass through verbatim as the
 * renderer's canonical ``"0x..."`` string so the YAML serializer
 * keeps the hex form on disk (#952).
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

    if (entry.type === ConfigEntryType.INTEGER) {
      if (entry.display_format === "hex") {
        out[entry.key] = raw;
      } else {
        const n = typeof raw === "number" ? raw : Number.parseInt(String(raw), 10);
        if (!Number.isNaN(n)) out[entry.key] = n;
      }
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
