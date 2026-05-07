/**
 * Helpers for the visual editor's hex-typed integer fields
 * (`ConfigEntry.display_format === "hex"`).
 *
 * These pair with `<input type="text">` rendering in
 * `config-entry-renderers.ts`'s number-field branch. The native
 * `<input type="number">` doesn't accept `0x...` literals, so the
 * hex-display branch routes through these helpers instead.
 *
 * Two-way conversion shape:
 *
 * - **YAML → form display**: any integer (`118`, `0x76`, `"0x76"`)
 *   resolves to a single number. We render it as
 *   `formatHexInt(value)` → `"0x76"` (lowercase canonical form,
 *   matching `repr()` and `cv.hex_int`'s own output formatter).
 * - **Form input → emit**: `parseHexInt("0x76" | "0X76" | "76" |
 *   "118")` → number. Both hex and decimal-looking input are
 *   accepted; the user can type whichever is most natural for the
 *   value at hand. Empty string → `null` (so optional entries get
 *   stripped from the payload by the form's coerce pass).
 *
 * Round-trip preservation: when the YAML had `address: 0x76`, the
 * form shows `0x76` and the user can save without forcing the
 * file to flip to `address: 118`. The serializer in
 * `yaml-section-values.ts` formats hex-typed values as `0x..`
 * literals on write so the on-disk shape stays readable.
 */

/**
 * Parse user-typed input into an integer.
 *
 * Accepts:
 *  - hex with `0x` / `0X` prefix (`"0x76"`, `"0X1A"`);
 *  - bare hex when the leading character disambiguates it as such
 *    (intentionally NOT supported — `"76"` is decimal, see below);
 *  - decimal (`"118"`);
 *  - leading/trailing whitespace.
 *
 * Returns `null` for empty input or any value that doesn't parse
 * as a finite integer. The caller decides whether to clear the
 * field, surface a validation error, etc.
 *
 * Why no bare hex without `0x`: the i2c address `76` is ambiguous
 * — it could be the user typing decimal 76 (intending `0x4C`) or
 * "0x76 with the prefix dropped" (intending `0x76` = 118). YAML
 * and ESPHome both treat unprefixed input as decimal, so we
 * follow that — typing `76` saves as `address: 76` (decimal),
 * typing `0x76` saves as `address: 0x76`.
 */
export function parseHexInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Reject internal whitespace / sign / exponents. ``Number.parseInt``
  // happily eats trailing junk (``parseInt("0x76xyz") === 118``),
  // which would silently swallow user typos.
  let value: number;
  if (/^0[xX][0-9a-fA-F]+$/.test(trimmed)) {
    value = Number.parseInt(trimmed.slice(2), 16);
  } else if (/^-?\d+$/.test(trimmed)) {
    value = Number.parseInt(trimmed, 10);
  } else {
    return null;
  }
  if (!Number.isFinite(value)) return null;
  return value;
}

/**
 * Walk a values dict and rewrite numeric values whose corresponding
 * config entry has ``display_format === "hex"`` to their canonical
 * ``"0x..."`` string form.
 *
 * Why: YAML's hex literal grammar (`address: 0x76`) parses to a
 * plain integer (118) on the way in, so by the time the form
 * receives a values dict the hex notation is gone. Without this
 * normalisation, a user who edits an unrelated field in the same
 * section and clicks Save sees their hex address flip to decimal
 * (`address: 118`) on disk — the YAML serializer emits numbers
 * verbatim, with no schema knowledge to reach for the hex form.
 *
 * Pre-formatting once at parse time means every save preserves the
 * user's hex notation, regardless of which field was actually
 * edited. ESPHome's ``cv.hex_int`` validator accepts either form
 * (``0x76`` unquoted, ``"0x76"`` quoted, or ``118`` decimal), so
 * the on-disk shape stays valid either way.
 *
 * Top-level only — nested hex fields would need a recursive walk
 * over ``entry.config_entries`` (i2c addresses are flat children
 * of their component, no nesting today; revisit if a future hex
 * field lands inside a NESTED group).
 *
 * Returns a fresh object; the input is never mutated.
 */
import type { ConfigEntry } from "../api/types.js";

export function normalizeHexValues(
  values: Record<string, unknown>,
  entries: ConfigEntry[],
): Record<string, unknown> {
  let needsCopy = false;
  for (const entry of entries) {
    if (entry.display_format !== "hex") continue;
    const v = values[entry.key];
    if (typeof v === "number") {
      needsCopy = true;
      break;
    }
  }
  if (!needsCopy) return values;
  const out: Record<string, unknown> = { ...values };
  for (const entry of entries) {
    if (entry.display_format !== "hex") continue;
    const v = out[entry.key];
    if (typeof v === "number") {
      const formatted = formatHexInt(v);
      // ``formatHexInt`` returns ``""`` for non-finite / negative
      // / non-integer numbers — leave those alone so the form's
      // existing validation can flag them.
      if (formatted !== "") out[entry.key] = formatted;
    }
  }
  return out;
}

/**
 * Format an arbitrary form value as a hex literal for display.
 *
 * Returns `"0x" + lowercase-hex` matching ESPHome's own
 * `cv.hex_int` formatter (`f"0x{value:02X}"` style — caps in
 * Python, but the dashboard standardised on lowercase to match
 * the `0x76` form Home Assistant docs and most i2c datasheets
 * use).
 *
 * Accepts `unknown` so callers can pass straight from the form
 * value bag without retyping. The parser only handles
 * non-negative finite integers (passed numerically) or strings
 * (which round-trip through `parseHexInt`); every other shape
 * — `null`, `undefined`, `""`, `NaN`, `3.14`, `-1`, `true`,
 * objects, arrays — returns `""` so the form field clears
 * rather than showing `0xNaN` / a fractional value the YAML
 * parser would reject.
 *
 * Negative numbers — not meaningful for the i2c-address /
 * register-address fields this targets — also clear.
 */
export function formatHexInt(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  let n: number | null;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    n = parseHexInt(value);
  } else {
    return "";
  }
  if (n === null || !Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return "";
  }
  return "0x" + n.toString(16);
}
