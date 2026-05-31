import { describe, expect, it } from "vitest";
import { formatYamlScalar } from "../../src/util/yaml-serialize.js";

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
