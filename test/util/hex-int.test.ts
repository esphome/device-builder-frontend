/**
 * Tests for the hex-typed integer field helpers.
 *
 * Backs the issue #410 fix — i2c address fields and the wider
 * `cv.hex_uint*_t` family now carry `display_format: "hex"` from
 * the catalog so the visual editor renders / accepts hex literals
 * instead of decimal-only number inputs. These helpers feed both
 * the renderer (`renderHexIntField`) and the section-config
 * loader's parse-time normalisation pass.
 */

import { describe, expect, it } from "vitest";
import { ConfigEntryType, type ConfigEntry } from "../../src/api/types.js";
import { makeConfigEntry } from "../../src/util/config-entry-defaults.js";
import { formatHexInt, normalizeHexValues, parseHexInt } from "../../src/util/hex-int.js";

const entry = (key: string, overrides: Partial<ConfigEntry> = {}): ConfigEntry =>
  makeConfigEntry({ key, type: ConfigEntryType.INTEGER, label: key, ...overrides });

describe("parseHexInt", () => {
  it("parses 0x-prefixed lowercase hex", () => {
    expect(parseHexInt("0x76")).toBe(0x76);
    expect(parseHexInt("0xff")).toBe(255);
  });

  it("parses 0X-prefixed uppercase hex", () => {
    // ESPHome's cv.hex_int lowercases before parsing, but the user
    // can type either case in the form.
    expect(parseHexInt("0X1A")).toBe(0x1a);
  });

  it("parses bare decimal", () => {
    // Hardware datasheets sometimes list the address as a decimal
    // (``119`` for the BME280); accept that too.
    expect(parseHexInt("118")).toBe(118);
    expect(parseHexInt("0")).toBe(0);
  });

  it("trims surrounding whitespace", () => {
    expect(parseHexInt("  0x76 ")).toBe(0x76);
    expect(parseHexInt("\t118\n")).toBe(118);
  });

  it("returns null for empty / whitespace-only input", () => {
    // The form's emit pass treats null as "user cleared the field",
    // routing through the empty-string branch instead of letting
    // an unparseable string leak into the YAML.
    expect(parseHexInt("")).toBeNull();
    expect(parseHexInt("   ")).toBeNull();
  });

  it("rejects 0x with no digits", () => {
    // ``parseInt("", 16) === NaN`` would silently coerce; the
    // explicit regex gate avoids that.
    expect(parseHexInt("0x")).toBeNull();
  });

  it("rejects mixed garbage and trailing-junk hex", () => {
    // ``Number.parseInt`` happily eats trailing junk
    // (``parseInt("0x76xyz", 16) === 118``); the strict regex
    // gate keeps typos surfacing as "invalid" instead of being
    // silently swallowed.
    expect(parseHexInt("0x76xyz")).toBeNull();
    expect(parseHexInt("76abc")).toBeNull();
    expect(parseHexInt("not a number")).toBeNull();
  });

  it("rejects bare hex digits without the 0x prefix", () => {
    // ``"abc"`` could mean ``0xabc`` or could be a typo. ESPHome
    // and YAML both treat unprefixed input as decimal — bare
    // ``"76"`` is decimal 76, not hex 76 (= 118). Bare hex
    // letters fail the decimal regex and return null.
    expect(parseHexInt("abc")).toBeNull();
    expect(parseHexInt("ff")).toBeNull();
  });

  it("accepts negative decimal", () => {
    // Negatives aren't meaningful for the address fields this
    // targets, but the parser stays general — ``formatHexInt``
    // is the one that filters non-representable inputs out.
    expect(parseHexInt("-1")).toBe(-1);
  });
});

describe("formatHexInt", () => {
  it("formats integers as 0x-prefixed lowercase hex", () => {
    expect(formatHexInt(0x76)).toBe("0x76");
    expect(formatHexInt(255)).toBe("0xff");
    expect(formatHexInt(0)).toBe("0x0");
  });

  it("round-trips strings through parseHexInt first", () => {
    expect(formatHexInt("0x76")).toBe("0x76");
    expect(formatHexInt("118")).toBe("0x76");
    expect(formatHexInt("0X1A")).toBe("0x1a");
  });

  it("returns empty string for null / undefined / empty inputs", () => {
    expect(formatHexInt(null)).toBe("");
    expect(formatHexInt(undefined)).toBe("");
    expect(formatHexInt("")).toBe("");
  });

  it("returns empty string for non-finite / fractional / negative", () => {
    // Form would otherwise show ``0xNaN`` / ``0x-1`` / a fractional
    // hex, none of which YAML accepts. Empty falls through to the
    // renderer's ``String(value)`` fallback so the user still
    // sees their content while the validator flags it.
    expect(formatHexInt(Number.NaN)).toBe("");
    expect(formatHexInt(Number.POSITIVE_INFINITY)).toBe("");
    expect(formatHexInt(3.14)).toBe("");
    expect(formatHexInt(-1)).toBe("");
  });

  it("returns empty string for non-numeric / non-string inputs", () => {
    // The renderer passes ``unknown`` straight through from the
    // form's value bag; ``true`` / ``[]`` / objects are nothing
    // the hex formatter can represent.
    expect(formatHexInt(true)).toBe("");
    expect(formatHexInt([1, 2, 3])).toBe("");
    expect(formatHexInt({})).toBe("");
  });

  it("returns empty string when the source string is unparseable", () => {
    // ``parseHexInt`` returns null → format returns "".
    expect(formatHexInt("not a number")).toBe("");
    expect(formatHexInt("0x76xyz")).toBe("");
  });
});

describe("normalizeHexValues", () => {
  it("rewrites hex-typed numeric values to 0x-prefixed strings", () => {
    // The bug shape: YAML ``address: 0x76`` parses to 118, the
    // form receives the number, and a save flips the file to
    // ``118``. After normalisation the dict carries ``"0x76"``
    // and the serializer writes hex back out.
    const entries = [entry("address", { display_format: "hex" })];
    expect(normalizeHexValues({ address: 119 }, entries)).toEqual({
      address: "0x77",
    });
  });

  it("leaves non-hex-typed values untouched", () => {
    // Same byte range, but a plain ``cv.uint8_t`` field — a
    // counter, percentage, log limit. Decimal display is
    // correct; the flag MUST be per-field.
    const entries = [entry("count", { display_format: null })];
    expect(normalizeHexValues({ count: 42 }, entries)).toEqual({ count: 42 });
  });

  it("leaves already-formatted hex strings untouched", () => {
    // Idempotent — values that were saved with hex notation and
    // came back through a YAML round-trip as strings stay as-is.
    const entries = [entry("address", { display_format: "hex" })];
    expect(normalizeHexValues({ address: "0x76" }, entries)).toEqual({
      address: "0x76",
    });
  });

  it("returns the same object reference when nothing needs rewriting", () => {
    // Cheap shortcut so a non-hex section doesn't allocate a copy
    // on every form load. ``identity-equal`` is the cue downstream
    // memoisation can lean on.
    const entries = [entry("count", { display_format: null })];
    const input = { count: 42 };
    expect(normalizeHexValues(input, entries)).toBe(input);
  });

  it("preserves unrelated keys present in values but not in entries", () => {
    // The catalog's entries cover only the schema's known fields;
    // a YAML with a passthrough key (an automation block, an
    // ``id:`` field the catalog didn't enumerate) must keep that
    // key intact.
    const entries = [entry("address", { display_format: "hex" })];
    expect(
      normalizeHexValues(
        { address: 119, id: "my_sensor", on_value: { lambda: "x" } },
        entries,
      ),
    ).toEqual({
      address: "0x77",
      id: "my_sensor",
      on_value: { lambda: "x" },
    });
  });

  it("skips values that fail formatHexInt's filter", () => {
    // Negatives / fractions / NaN don't get rewritten — the form
    // surfaces them as-is so the inline validator can flag them
    // instead of the normaliser silently dropping the value.
    const entries = [entry("addr", { display_format: "hex" })];
    expect(normalizeHexValues({ addr: -1 }, entries)).toEqual({ addr: -1 });
    expect(normalizeHexValues({ addr: 3.14 }, entries)).toEqual({
      addr: 3.14,
    });
    expect(normalizeHexValues({ addr: Number.NaN }, entries)).toEqual({
      addr: Number.NaN,
    });
  });

  it("preserves a null prototype on the returned object", () => {
    // ``parseYamlSectionValues`` returns ``Object.create(null)``
    // maps to defend against user-keyed YAML containing
    // ``__proto__`` / ``constructor`` / ``prototype``. A naive
    // ``{ ...values }`` spread would promote that to a regular
    // ``Object``-prototype object and re-open the prototype-
    // pollution attack surface. Pin that the rewrite path
    // preserves the input's prototype.
    const entries = [entry("address", { display_format: "hex" })];
    const input = Object.assign(Object.create(null), { address: 119 });
    const out = normalizeHexValues(input, entries);
    expect(Object.getPrototypeOf(out)).toBeNull();
    expect(out).not.toBe(input);
    expect(out["address"]).toBe("0x77");
  });

  it("preserves an Object prototype on the returned object", () => {
    // Symmetric check for callers that pass a regular ``{}`` map
    // (test fixtures, not the live ``parseYamlSectionValues``
    // path) — they still expect the prototype they handed in.
    const entries = [entry("address", { display_format: "hex" })];
    const input = { address: 119 };
    const out = normalizeHexValues(input, entries);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(out).not.toBe(input);
    expect(out["address"]).toBe("0x77");
  });
});
