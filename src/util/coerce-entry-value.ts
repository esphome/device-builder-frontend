import type { ConfigEntry } from "../api/types/config-entries.js";
import { ConfigEntryType } from "../api/types/config-entries.js";
import { coerceIntFieldValue } from "./int-input.js";
import { parseYamlBoolean } from "./yaml-serialize.js";

/**
 * Coerce a control's string value back to the entry's declared numeric
 * type before emitting. A wa-select / combo box always hands back a
 * string, but an INTEGER/FLOAT field's YAML must be a number or downstream
 * validation (and the backend's locked-value compare) rejects it. INTEGER
 * goes through ``coerceIntFieldValue`` so a >2^53 decimal stays a string
 * (64-bit precision, #378/#944) and a ``0x…`` literal isn't truncated.
 * BOOLEAN spellings coerce through ``parseYamlBoolean``. Other entries,
 * an empty string, and unparseable input pass through unchanged so the
 * inline validator can flag them.
 */
export function coerceValueToEntryType(
  entry: ConfigEntry,
  raw: string
): string | number | boolean {
  if (entry.type === ConfigEntryType.INTEGER) return coerceIntFieldValue(raw);
  if (entry.type === ConfigEntryType.FLOAT) return coerceFloatFieldValue(raw);
  // Spellings emit as booleans so a corrected value serializes bare
  // (`false`, not `"false"`); blank stays blank and junk ships trimmed,
  // mirroring the int/float coercers.
  if (entry.type === ConfigEntryType.BOOLEAN) {
    const v = raw.trim();
    return v === "" ? "" : (parseYamlBoolean(v) ?? v);
  }
  return raw;
}

/** Finite input becomes a number; blank and non-finite input (a typed
 *  ``1e309``) ship as ""/verbatim so the validator flags them instead of
 *  the serializer writing a bare ``Infinity`` (#1361). Trims like
 *  ``coerceIntFieldValue`` so whitespace-only input stays blank, not 0. */
export function coerceFloatFieldValue(raw: string): string | number {
  const v = raw.trim();
  if (v === "") return "";
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}

/** Script-parameter variant keyed on the param's type token; ints never
 *  prefix-parse (``parseInt`` read ``1e309`` as 1) and floats never
 *  commit Infinity, which JSON-serializes to null on the WS wire. */
export function coerceParamValue(type: string, raw: string): string | number {
  if (type === "int") return coerceIntFieldValue(raw);
  if (type === "float") return coerceFloatFieldValue(raw);
  return raw;
}
