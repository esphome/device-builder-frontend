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
 *   resolves to a canonical hex string. We render it as
 *   `formatHexInt(value)` → `"0x76"` (lowercase, no padding —
 *   `value.toString(16)`-style; ESPHome's own `cv.hex_int`
 *   formatter uses uppercase, but the dashboard standardised on
 *   lowercase for user-facing display since that's what HA docs
 *   and most i2c datasheets use).
 * - **Form input → emit**: `parseHexInt("0x76" | "0X76" | "118")`
 *   → canonical `"0x..."` string. Both hex (with explicit `0x`
 *   prefix) and decimal input are accepted; the user can type
 *   whichever is most natural for the value at hand. Parsing is
 *   `BigInt`-backed, so 64-bit values like a DS18B20 ROM
 *   (`0xbe030c9794184728`, range up to `2^64 - 1` per the catalog)
 *   round-trip without IEEE-754 precision loss (#944). Empty
 *   string → `null` (so optional entries get stripped from the
 *   payload by the form's coerce pass).
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
 * Parse user-typed input into a canonical lowercase ``"0x..."``
 * hex string.
 *
 * Accepts:
 *  - hex with `0x` / `0X` prefix (`"0x76"`, `"0X1A"`);
 *  - non-negative decimal (`"118"`);
 *  - leading/trailing whitespace around either form.
 *
 * Returns `null` for empty input, negative numbers, or any value
 * that doesn't parse as a non-negative integer. The caller
 * decides whether to clear the field, surface a validation
 * error, etc.
 *
 * Backed by `BigInt`, not `Number`, so 64-bit values like a
 * DS18B20 ROM (`0xbe030c9794184728`) and the catalog's full
 * `cv.hex_uint64_t` range (up to `2^64 - 1`) survive the
 * round-trip. `Number.parseInt(s, 16)` rounded to the nearest
 * representable double for any hex over 2^53, silently mutating
 * the user's value on save (#944).
 *
 * **Bare hex without `0x` is intentionally rejected.** The i2c
 * address `76` would otherwise be ambiguous — could be the user
 * typing decimal 76 (intending `0x4C`) or "0x76 with the prefix
 * dropped" (intending `0x76` = 118). YAML and ESPHome both treat
 * unprefixed input as decimal, so we follow that: typing `76`
 * saves as `address: 0x4c` (decimal canonicalised to hex),
 * typing `0x76` saves as `address: 0x76`. Bare hex letters
 * (`"abc"`, `"ff"`) hit neither regex and return `null`.
 */
// ``BigInt`` is more permissive than we want (``BigInt("")`` is
// ``0n``, ``BigInt(" 1 ")`` is ``1n``); this regex gate accepts
// only the two forms we route through it:
//   - ``0x`` / ``0X`` prefix followed by one or more hex digits;
//   - one or more decimal digits (negatives intentionally
//     rejected — uint64 only for the address fields this targets).
// Everything else — internal whitespace, ``+`` / ``-`` sign,
// exponents (``1e3``), fractional (``3.14``), trailing characters,
// unprefixed hex letters — falls through to ``return null``.
const ACCEPTED_INPUT_RE = /^(?:0[xX][0-9a-fA-F]+|\d+)$/;

// What ``parseHexInt`` / ``formatHexInt`` emit — minimum-width
// lowercase ``"0x..."``. Tighter than the input regex on purpose:
// ``"0x076"`` is rejected here so the canonical-form fast path in
// ``formatHexInt`` / ``normalizeHexValues`` agrees bit-for-bit
// with what the BigInt slow path would produce (which strips the
// leading zero). Without this tightening the two paths return
// different strings for the same input.
const CANONICAL_HEX_RE = /^0x(?:[1-9a-f][0-9a-f]*|0)$/;

export function parseHexInt(raw: string): string | null {
  const trimmed = raw.trim();
  if (!ACCEPTED_INPUT_RE.test(trimmed)) return null;
  return "0x" + BigInt(trimmed).toString(16);
}

/**
 * Walk a values dict and rewrite every hex-typed entry's value to
 * its canonical lowercase ``"0x..."`` string form. Numeric (number
 * or bigint) values stringify through ``formatHexInt``; string
 * values (including uppercase, leading-zero, and decimal-typed-as-
 * string shapes) round-trip through ``parseHexInt``; already-
 * canonical strings short-circuit without allocating a copy.
 *
 * Why: the form's values dict carries heterogeneous types
 * (``parseYamlSectionValues`` hands hex literals back as raw
 * strings; ``add-component`` paths can produce numbers / bigints).
 * Without this pass, a user who edits an unrelated field in the
 * same section and clicks Save sees their hex address flip shape
 * on disk — the YAML serializer emits whatever's in the dict
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
  entries: ConfigEntry[]
): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  for (const entry of entries) {
    if (entry.display_format !== "hex") continue;
    const v = values[entry.key];
    let formatted: string;
    if (typeof v === "number" || typeof v === "bigint") {
      formatted = formatHexInt(v);
    } else if (typeof v === "string") {
      // Already-canonical lowercase ``"0x..."``: nothing to rewrite,
      // and the identity-return shortcut for non-hex sections
      // depends on us not allocating a copy here.
      if (CANONICAL_HEX_RE.test(v)) continue;
      // The `parseYamlSectionValues` parser hands hex literals back
      // as strings (`parseScalar` only special-cases true/false), so
      // this is the live path for fresh YAML loads. Canonicalising
      // here is what makes `address: 0xBE030C9794184728` (uppercase)
      // round-trip losslessly through the visual editor — without
      // it the renderer's `formatHexInt` re-parses every render and
      // the values dict drifts from on-disk on the next save.
      const parsed = parseHexInt(v);
      if (parsed === null) continue;
      formatted = parsed;
    } else {
      continue;
    }
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
        Object.getOwnPropertyDescriptors(values)
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
 * value bag without retyping. Already-canonical hex strings
 * (`"0x..."`, lowercase) pass through identity-equal — that's
 * the hot path for values that came out of `parseHexInt` /
 * `normalizeHexValues` and avoids re-parsing 64-bit hex on every
 * render (#944). Numbers / bigints / non-canonical strings flow
 * through the parse path; every other shape — `null`, `undefined`,
 * `""`, `NaN`, `3.14`, `-1`, `true`, objects, arrays — returns
 * `""` so the form field clears rather than showing `0xNaN` / a
 * fractional value the YAML parser would reject.
 *
 * Negative numbers — not meaningful for the i2c-address /
 * register-address fields this targets — also clear.
 */
export function formatHexInt(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string") {
    // Hot path: a canonical lowercase hex string from the parser
    // (or a prior `formatHexInt` call) flows through verbatim,
    // sidestepping `BigInt` allocation on every keystroke.
    if (CANONICAL_HEX_RE.test(value)) return value;
    return parseHexInt(value) ?? "";
  }
  if (typeof value === "number") {
    // ``Number.isSafeInteger`` rejects NaN, +/-Infinity, fractional
    // values, and anything above 2^53 in one shot. The upper bound
    // matters: a caller that hands us 0xbe030c9794184728 as a JS
    // Number has already lost precision before we see it; stringifying
    // the rounded double would silently reintroduce the #944 bug.
    // Bigint / canonical-string callers stay on their precision-safe
    // branches above.
    if (!Number.isSafeInteger(value) || value < 0) return "";
    return "0x" + value.toString(16);
  }
  if (typeof value === "bigint") {
    if (value < 0n) return "";
    return "0x" + value.toString(16);
  }
  return "";
}
