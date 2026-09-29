import { isPrimitiveOrNullish } from "./nested-values.js";
import { parsePlainDecimal } from "./yaml-scalar.js";

/**
 * The option spelling *raw* lands on, or null when no option presents it:
 * the same text, a case fold (``esp32c6`` / ``ESP32C6``), or, for a number
 * only, the same plain decimal: a bare YAML ``3.0`` reads as 3 while the
 * catalog spells the option ``"3.0"``. A quoted ``"3"`` arrives as a string
 * and keeps its own spelling; a non-primitive never matches.
 */
export function findOptionValue(raw: unknown, options: readonly string[]): string | null {
  if (!isPrimitiveOrNullish(raw) || raw == null) return null;
  const text = String(raw);
  if (!text) return null;
  if (options.includes(text)) return text;
  const lower = text.toLowerCase();
  const folded = options.find((o) => o.toLowerCase() === lower);
  if (folded !== undefined) return folded;
  if (typeof raw !== "number") return null;
  return options.find((o) => parsePlainDecimal(o) === raw) ?? null;
}
