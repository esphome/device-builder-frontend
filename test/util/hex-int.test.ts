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
  it("parses 0x-prefixed lowercase hex to canonical 0x-string", () => {
    expect(parseHexInt("0x76")).toBe("0x76");
    expect(parseHexInt("0xff")).toBe("0xff");
  });

  it("lowercases 0X-prefixed uppercase hex", () => {
    // ESPHome's cv.hex_int lowercases before parsing, but the user
    // can type either case in the form. We standardised on lowercase
    // for display.
    expect(parseHexInt("0X1A")).toBe("0x1a");
  });

  it("canonicalises bare decimal to its hex form", () => {
    // Hardware datasheets sometimes list the address as a decimal
    // (``119`` for the BME280); accept that and rewrite to the
    // hex-typed field's canonical shape so the on-disk YAML matches
    // the catalog's display_format intent.
    expect(parseHexInt("118")).toBe("0x76");
    expect(parseHexInt("0")).toBe("0x0");
  });

  it("preserves precision for 64-bit hex (DS18B20 ROM, #944)", () => {
    // ``Number.parseInt("0xbe030c9794184728", 16)`` rounds to
    // 0xbe030c9794184800 because the value exceeds 2^53. The
    // BigInt-backed parser must round-trip the exact bits.
    expect(parseHexInt("0xbe030c9794184728")).toBe("0xbe030c9794184728");
    expect(parseHexInt("0xBE030C9794184728")).toBe("0xbe030c9794184728");
  });

  it("round-trips uint64 max (cv.hex_uint64_t range)", () => {
    // Catalog declares dallas_temp.address range up to 2^64 − 1.
    expect(parseHexInt("0xffffffffffffffff")).toBe("0xffffffffffffffff");
    expect(parseHexInt("18446744073709551615")).toBe("0xffffffffffffffff");
  });

  it("strips leading zeros from hex input", () => {
    // ``BigInt("0x076").toString(16)`` is ``"76"``; the canonical
    // form is unique so the form's display, the values dict, and
    // on-disk YAML all agree on a single shape.
    expect(parseHexInt("0x076")).toBe("0x76");
    expect(parseHexInt("0x00be030c9794184728")).toBe("0xbe030c9794184728");
  });

  it("canonicalises zero to 0x0 regardless of input shape", () => {
    // Pin the zero corner of CANONICAL_HEX_RE so a future tweak to
    // the regex can't desynchronise the slow path's BigInt(0) output
    // from the canonical-form gate ``formatHexInt`` /
    // ``normalizeHexValues`` use to skip rewriting.
    expect(parseHexInt("0")).toBe("0x0");
    expect(parseHexInt("0x0")).toBe("0x0");
    expect(parseHexInt("0x00")).toBe("0x0");
    expect(parseHexInt("0x000")).toBe("0x0");
  });

  it("trims surrounding whitespace", () => {
    expect(parseHexInt("  0x76 ")).toBe("0x76");
    expect(parseHexInt("\t118\n")).toBe("0x76");
  });

  it("returns null for empty / whitespace-only input", () => {
    // The form's emit pass treats null as "user cleared the field",
    // routing through the empty-string branch instead of letting
    // an unparseable string leak into the YAML.
    expect(parseHexInt("")).toBeNull();
    expect(parseHexInt("   ")).toBeNull();
  });

  it("rejects 0x with no digits", () => {
    // ``BigInt("0x")`` throws; the explicit regex gate filters
    // this before the constructor.
    expect(parseHexInt("0x")).toBeNull();
  });

  it("rejects mixed garbage and trailing-junk hex", () => {
    // The strict regex gate keeps typos surfacing as "invalid"
    // instead of being silently swallowed.
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

  it("rejects negatives at parse time", () => {
    // Negatives aren't meaningful for the uint64 address / register
    // fields this targets. Rejecting at the parser keeps the
    // renderer's ``formatHexInt(parseHexInt(raw)) || raw`` chain
    // falling through to the raw string so the inline validator can
    // flag it, identical to today's end-user behaviour.
    expect(parseHexInt("-1")).toBeNull();
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

  it("passes canonical 0x-strings through losslessly (64-bit, #944)", () => {
    // Hot path: a value that already came out of ``parseHexInt`` or
    // ``normalizeHexValues`` skips the BigInt round-trip and the
    // canonical regex shortcut returns the exact bits. Pinning the
    // 64-bit case keeps the renderer's per-keystroke render from
    // regressing into the lossy Number.parseInt path.
    expect(formatHexInt("0xbe030c9794184728")).toBe("0xbe030c9794184728");
    expect(formatHexInt("0xffffffffffffffff")).toBe("0xffffffffffffffff");
  });

  it("canonicalises non-canonical hex strings (leading zeros)", () => {
    // ``"0x076"`` matches the input regex but not the canonical-form
    // gate, so the slow path strips the leading zero. Both formatters
    // must agree on the output for a single value.
    expect(formatHexInt("0x076")).toBe("0x76");
    expect(formatHexInt("0x00be030c9794184728")).toBe("0xbe030c9794184728");
  });

  it("agrees with parseHexInt at the zero edge", () => {
    // ``formatHexInt`` must not return ``"0x00"`` for a string that
    // ``parseHexInt`` canonicalises to ``"0x0"``; otherwise the
    // ``normalizeHexValues`` fast-path skip would diverge from a
    // subsequent re-format.
    expect(formatHexInt("0x0")).toBe("0x0");
    expect(formatHexInt("0x00")).toBe("0x0");
    expect(formatHexInt(0)).toBe("0x0");
  });

  it("rejects numbers above Number.MAX_SAFE_INTEGER (#944 latent footgun)", () => {
    // ``Number.isInteger`` returns true for any double whose
    // fractional part is zero, including values past 2^53 where the
    // double has already been rounded. Stringifying those would
    // re-introduce the precision loss this PR fixes. Pin the
    // ``Number.isSafeInteger`` gate so a future relaxation can't
    // silently regress the bug.
    expect(formatHexInt(Number.MAX_SAFE_INTEGER + 1)).toBe("");
    expect(formatHexInt(2 ** 60)).toBe("");
  });

  it("formats bigint inputs as 0x-prefixed lowercase hex", () => {
    expect(formatHexInt(0x76n)).toBe("0x76");
    expect(formatHexInt(0xbe030c9794184728n)).toBe("0xbe030c9794184728");
    expect(formatHexInt(-1n)).toBe("");
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

  it("canonicalises uppercase hex strings from parseYamlSectionValues", () => {
    // The live path post-#944: parseYamlSectionValues returns hex
    // literals as raw strings (parseScalar only special-cases
    // true/false). Loading needs to lowercase so the dict / on-disk
    // / display agree on a single shape.
    const entries = [entry("address", { display_format: "hex" })];
    expect(normalizeHexValues({ address: "0xBE030C9794184728" }, entries)).toEqual({
      address: "0xbe030c9794184728",
    });
  });

  it("preserves 64-bit precision through string canonicalisation (#944)", () => {
    // Direct pin against the bug: a DS18B20 ROM address must
    // round-trip the exact bits, not be rounded by Number.parseInt.
    const entries = [entry("address", { display_format: "hex" })];
    expect(normalizeHexValues({ address: "0xbe030c9794184728" }, entries)).toEqual({
      address: "0xbe030c9794184728",
    });
  });

  it("strips leading zeros from non-canonical hex strings", () => {
    // Without canonicalisation here the fast path returns the
    // string verbatim while a later edit re-renders the value
    // through ``parseHexInt`` and the leading zero disappears; the
    // values dict and on-disk YAML would silently disagree.
    const entries = [entry("address", { display_format: "hex" })];
    expect(normalizeHexValues({ address: "0x076" }, entries)).toEqual({
      address: "0x76",
    });
  });

  it("rewrites bigint hex values to canonical 0x-strings", () => {
    // The form's value bag is heterogeneous; bigints flow through
    // the same canonicalisation pass as numbers.
    const entries = [entry("address", { display_format: "hex" })];
    expect(normalizeHexValues({ address: 0xbe030c9794184728n }, entries)).toEqual({
      address: "0xbe030c9794184728",
    });
  });

  it("leaves unparseable hex-typed strings alone for the validator", () => {
    // ``!lambda`` / templated values / typos shouldn't be silently
    // rewritten — the form's inline validator flags them.
    const entries = [entry("address", { display_format: "hex" })];
    expect(normalizeHexValues({ address: "!lambda return 1;" }, entries)).toEqual({
      address: "!lambda return 1;",
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
        entries
      )
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
