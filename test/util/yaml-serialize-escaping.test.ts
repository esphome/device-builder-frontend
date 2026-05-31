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
