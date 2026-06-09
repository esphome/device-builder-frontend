// The integer literals ESPHome's cv.int_ accepts: a bare decimal (optionally
// negative) or non-negative 0x hex. Decimal is emitted as a number so its YAML
// / WS form stays numeric; hex / anything else stays a verbatim string.
const DECIMAL_INT_RE = /^-?\d+$/;
const HEX_INT_RE = /^0x[0-9a-f]+$/i;

/**
 * BigInt value of a decimal-or-hex integer literal (what `cv.int_` accepts),
 * or null for any other form. Lets validation reject `1e3` / `1.5` and
 * range-check 64-bit values precisely, matching `coerceIntFieldValue`.
 */
export function parseIntInput(raw: unknown): bigint | null {
  const v = String(raw ?? "").trim();
  // The regexes admit only ``BigInt``-parseable literals, so call it directly
  // (mirrors ``parseHexInt``) — a future regex change that breaks that
  // invariant should throw loudly, not be swallowed into a silent null.
  if (!DECIMAL_INT_RE.test(v) && !HEX_INT_RE.test(v)) return null;
  return BigInt(v);
}

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
