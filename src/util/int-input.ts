// A bare decimal integer (optionally negative). Such input is emitted as a
// number so its YAML / WS form stays numeric (and unquoted on disk); hex
// (0x..) or anything else stays a verbatim string — ESPHome's cv.int_ parses
// 0x.. on its own, and the inline validator flags junk.
const DECIMAL_INT_RE = /^-?\d+$/;

/**
 * Normalise a decimal-or-hex integer field value: bare decimal → number,
 * hex / anything else → verbatim string, empty → "". Shared by the integer
 * renderer and the add-component coercer so neither truncates `0x1111` to `0`.
 * A decimal above 2^53 stays a string to keep 64-bit precision (#378/#944);
 * leading zeros on a safe int are dropped (`0042` → `42`).
 */
export function coerceIntFieldValue(raw: unknown): number | string {
  if (typeof raw === "number") return raw;
  const v = String(raw ?? "").trim();
  if (v === "") return "";
  if (!DECIMAL_INT_RE.test(v)) return v;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : v;
}
