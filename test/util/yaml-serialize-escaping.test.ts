import { describe, expect, it } from "vitest";
import { formatYamlScalar, serializeYamlValues } from "../../src/util/yaml-serialize.js";

// A Material Design Icon glyph (Plane-15 Private Use Area).
const MDI_A = String.fromCodePoint(0xf058f);
const MDI_B = String.fromCodePoint(0xf0f19);

// When formatYamlScalar quotes a value it must escape backslashes and
// control characters the same way the backend _quote helper does, so a
// value round-trips through YAML instead of a bare backslash forming an
// invalid escape on reload.
describe("formatYamlScalar escaping", () => {
  it("escapes a backslash inside a quoted value", () => {
    // leading quote forces quoting; the backslash must be escaped too
    expect(formatYamlScalar('"a\\b')).toBe('"\\"a\\\\b"');
  });

  it("escapes a tab inside a value that needs quoting", () => {
    expect(formatYamlScalar("a:\tb")).toBe('"a:\\tb"');
  });

  it("quotes and escapes a value containing a newline", () => {
    expect(formatYamlScalar("line1\nline2")).toBe('"line1\\nline2"');
  });

  it("leaves a plain identifier unquoted", () => {
    expect(formatYamlScalar("GPIO4")).toBe("GPIO4");
  });
});

// ESPHome loads via PyYAML (YAML 1.1). A typed-string field such as
// globals initial_value emitted bare as 0 reloads as an int and is
// rejected as EInt, so anything the loader would re-type must be quoted.
// The bare cases mirror values PyYAML resolves as plain strings.
describe("formatYamlScalar quotes values a YAML loader would re-type", () => {
  it.each([
    "0",
    "42",
    "-5",
    "+5",
    "1_000",
    "0755",
    "0b101",
    "3.14",
    ".5",
    "1.5e+3",
    ".inf",
    "-.inf",
    ".nan",
    "true",
    "True",
    "TRUE",
    "yes",
    "on",
    "off",
    "no",
    "null",
    "Null",
    "NULL",
    "~",
    "2024-01-01",
  ])("quotes %j so it stays a string", (value) => {
    expect(formatYamlScalar(value)).toBe(`"${value}"`);
  });

  it.each([
    "0x3c", // hex i2c address — intentionally left bare and readable
    "0xFF",
    "1.5e3", // unsigned exponent is a string in PyYAML
    "1e3",
    "tRUe", // casing outside the resolver set
    "y",
    "Y",
    "n",
    "GPIO4",
    "v1.2",
    "0.0.0.0",
  ])("leaves %j bare", (value) => {
    expect(formatYamlScalar(value)).toBe(value);
  });
});

describe("formatYamlScalar escapes Private-Use glyphs", () => {
  it("quotes and \\U-escapes an MDI glyph", () => {
    expect(formatYamlScalar(MDI_A)).toBe('"\\U000F058F"');
  });

  it("keeps an ordinary accented string bare", () => {
    expect(formatYamlScalar("Café")).toBe("Café");
  });
});

describe("serializeYamlValues — array nested in a list item", () => {
  it("emits a scalar array as a flow list, not a bare scalar", () => {
    // ``extras[].glyphs`` — without the list-item Array branch the array
    // collapses to a bare ``glyphs: \U000F058F`` (device-builder#1232).
    const out = serializeYamlValues(
      { extras: [{ file: "icons.ttf", glyphs: [MDI_A, MDI_B] }] },
      ""
    ).join("\n");
    expect(out).toContain('glyphs: ["\\U000F058F", "\\U000F0F19"]');
    expect(out).not.toContain("glyphs: \\U000F058F");
  });

  it("skips an empty nested array", () => {
    const out = serializeYamlValues(
      { extras: [{ file: "icons.ttf", glyphs: [] }] },
      ""
    ).join("\n");
    expect(out).not.toContain("glyphs");
  });

  it("quotes a comma-containing item in a nested flow list", () => {
    // formatYamlFlowScalar quotes flow indicators; the quote-aware parser
    // reads it back as one element (device-builder#647 review).
    const out = serializeYamlValues({ extras: [{ items: ["a,b", "c"] }] }, "").join("\n");
    expect(out).toContain('items: ["a,b", c]');
  });

  it("emits an array of objects nested in a list item as a block list", () => {
    // Non-scalar nested arrays use the block fallback (the structured
    // parser reads this back as an opaque block; the form never produces
    // this shape, so it is best-effort emission, not a round-trip path).
    const out = serializeYamlValues(
      { outer: [{ name: "x", items: [{ a: 1 }, { b: 2 }] }] },
      ""
    ).join("\n");
    expect(out).toBe(
      ["outer:", "  - name: x", "    items:", "      - a: 1", "      - b: 2"].join("\n")
    );
  });
});

describe("serializeYamlValues — lambda tag", () => {
  it("emits a tagged lambda as !lambda |- so it compiles as a lambda", () => {
    // Dropping the tag on a templatable value field (uart.write:)
    // would compile the body as a string literal, not a lambda.
    const out = serializeYamlValues(
      {
        set_action: [
          { "uart.write": { _lambda: "uint8_t a = 1;\nreturn {a};", _tag: "!lambda" } },
        ],
      },
      ""
    ).join("\n");
    expect(out).toBe(
      [
        "set_action:",
        "  - uart.write: !lambda |-",
        "      uint8_t a = 1;",
        "      return {a};",
      ].join("\n")
    );
  });

  it("emits an untagged lambda as a bare |- block (no !lambda injected)", () => {
    const out = serializeYamlValues({ lambda: { _lambda: "return x;" } }, "").join("\n");
    expect(out).toBe(["lambda: |-", "  return x;"].join("\n"));
  });
});
