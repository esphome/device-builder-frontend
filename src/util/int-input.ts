// A bare decimal integer (optionally negative). Such input is emitted as a
// number so its YAML / WS form stays numeric (and unquoted on disk); hex
// (0x..) or anything else stays a verbatim string — ESPHome's cv.int_ parses
// 0x.. on its own, and the inline validator flags junk.
const DECIMAL_INT_RE = /^-?\d+$/;

/**
 * Normalise a decimal-or-hex integer field value.
 *
 * Bare decimal → number; hex / anything else → the trimmed string verbatim;
 * empty → "". Shared by the integer renderer and the add-component coercer so
 * neither canonicalises hex (``0x1111`` must not become ``4369`` or, via
 * ``parseInt(..., 10)``, ``0``).
 */
export function coerceIntFieldValue(raw: unknown): number | string {
  if (typeof raw === "number") return raw;
  const v = String(raw ?? "").trim();
  if (v === "") return "";
  return DECIMAL_INT_RE.test(v) ? Number(v) : v;
}
