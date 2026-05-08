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
 *   `formatHexInt(value)` → `"0x76"` (lowercase, no padding —
 *   `value.toString(16)`-style; ESPHome's own `cv.hex_int`
 *   formatter uses uppercase, but the dashboard standardised on
 *   lowercase for user-facing display since that's what HA docs
 *   and most i2c datasheets use).
 * - **Form input → emit**: `parseHexInt("0x76" | "0X76" | "118")`
 *   → number. Both hex (with explicit `0x` prefix) and decimal
 *   input are accepted; the user can type whichever is most
 *   natural for the value at hand. Empty string → `null` (so
 *   optional entries get stripped from the payload by the form's
 *   coerce pass).
 *
 * Round-trip preservation: when the YAML had `address: 0x76`, the
 * form shows `0x76` and the user can save without forcing the
 * file to flip to `address: 118`. The mechanism is: this module
 * normalises hex-typed numeric form values into pre-formatted
 * `"0x..."` strings (via `normalizeHexValues` at parse time and
 * the renderer's emit-as-string at edit time); the YAML
 * serializer in `yaml-serialize.ts` is schema-agnostic, but it
 * passes string scalars through verbatim, so a value already
 * shaped as `"0x76"` lands on disk as `address: 0x76` without
 * the serializer needing to know about the hex hint.
 */

/**
 * Parse user-typed input into an integer.
 *
 * Accepts:
 *  - hex with `0x` / `0X` prefix (`"0x76"`, `"0X1A"`);
 *  - decimal (`"118"`, `"-1"`);
 *  - leading/trailing whitespace around either form.
 *
 * Returns `null` for empty input or any value that doesn't parse
 * as a finite integer. The caller decides whether to clear the
 * field, surface a validation error, etc.
 *
 * **Bare hex without `0x` is intentionally rejected.** The i2c
 * address `76` would otherwise be ambiguous — could be the user
 * typing decimal 76 (intending `0x4C`) or "0x76 with the prefix
 * dropped" (intending `0x76` = 118). YAML and ESPHome both treat
 * unprefixed input as decimal, so we follow that: typing `76`
 * saves as `address: 76` (decimal), typing `0x76` saves as
 * `address: 0x76`. Bare hex letters (`"abc"`, `"ff"`) hit
 * neither regex and return `null`.
 */
export function parseHexInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  // Strict regex gate. ``Number.parseInt`` happily eats trailing
  // junk (``parseInt("0x76xyz") === 118``), which would silently
  // swallow user typos. The two regexes accept only:
  //   - ``0x`` / ``0X`` prefix followed by one or more hex digits;
  //   - an optional leading ``-`` and one or more decimal digits.
  // Everything else — internal whitespace, ``+`` sign, exponents
  // (``1e3``), fractional (``3.14``), trailing characters,
  // unprefixed hex letters — falls through to ``return null``.
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
 * Returns the input object identity-equal when no rewrites are
 * needed (cheap shortcut for non-hex sections); otherwise returns
 * a fresh object preserving the input's prototype.
 *
 * Prototype preservation matters because ``parseYamlSectionValues``
 * deliberately produces a null-prototype map to defend against
 * user-keyed YAML containing ``__proto__`` / ``constructor`` /
 * ``prototype`` (which would otherwise mutate the inherited
 * prototype chain via ordinary property assignment). A naive
 * ``{ ...values }`` spread re-opens that attack surface by
 * promoting the result back to a regular ``Object``-prototype
 * object; we clone via
 * ``Object.create(getPrototypeOf(values),
 * getOwnPropertyDescriptors(values))`` instead, which preserves
 * whatever prototype the input had (null for the parser's
 * defensive map, ``Object.prototype`` for plain test fixtures)
 * and uses ``defineProperty`` semantics under the hood so a
 * crafted ``__proto__`` key on the source can't trigger
 * prototype mutation on the target.
 */
import type { ConfigEntry } from "../api/types.js";

export function normalizeHexValues(
  values: Record<string, unknown>,
  entries: ConfigEntry[],
): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const entry of entries) {
    if (entry.display_format !== "hex") continue;
    const v = values[entry.key];
    if (typeof v !== "number") continue;
    const formatted = formatHexInt(v);
    // ``formatHexInt`` returns ``""`` for non-finite / negative /
    // non-integer numbers — leave those alone so the form's
    // existing validation can flag them, no copy needed.
    if (formatted === "") continue;
    if (out === null) {
      // Lazy copy on first actual rewrite. ``Object.create``-with-
      // descriptors clones via ``defineProperty`` (no ``[[Set]]``
      // triggers, so a hostile own ``__proto__`` key on an Object-
      // proto source can't escalate to prototype mutation),
      // preserving the input's prototype — null for the parser's
      // null-proto defence, ``Object.prototype`` for fixtures.
      out = Object.create(
        Object.getPrototypeOf(values),
        Object.getOwnPropertyDescriptors(values),
      );
    }
    out![entry.key] = formatted;
  }
  return out ?? values;
}

/**
 * Format an arbitrary form value as a hex literal for display.
 *
 * Returns `"0x" + value.toString(16)` — the minimum-width
 * lowercase form. `0` → `"0x0"`, `0x76` → `"0x76"`,
 * `0xff00` → `"0xff00"`. Intentionally not zero-padded: i2c
 * addresses and register addresses are read at whatever width
 * the underlying integer needs, and forcing a fixed
 * width (e.g. always `0x00`-style for 8-bit) would mismatch
 * larger hex types (`hex_uint16_t`, `hex_uint32_t`) sharing
 * this formatter.
 *
 * Lowercase to match the `0x76` form Home Assistant docs and
 * most i2c datasheets use. ESPHome's own `cv.hex_int` formatter
 * uses uppercase, but its consumers compare numerically — the
 * casing only matters in the dashboard's user-facing display.
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
