/**
 * Pins the script-parameter commit coercion: ints never prefix-parse
 * (the old ``parseInt`` read ``1e309`` as 1) and floats never commit
 * Infinity, which JSON-serializes to null on the WS wire (#1361).
 */
import { describe, expect, it } from "vitest";
import { coerceParamValue } from "../../src/util/coerce-entry-value.js";

describe("coerceParamValue", () => {
  it("commits decimal int input as a number", () => {
    expect(coerceParamValue("int", "42")).toBe(42);
    expect(coerceParamValue("int", "-5")).toBe(-5);
  });

  it("ships non-decimal int input verbatim instead of prefix-parsing", () => {
    expect(coerceParamValue("int", "1e309")).toBe("1e309");
    expect(coerceParamValue("int", "0x10")).toBe("0x10");
    expect(coerceParamValue("int", "18446744073709551615")).toBe("18446744073709551615");
  });

  it("commits finite float input as a number, non-finite verbatim", () => {
    expect(coerceParamValue("float", "2.5")).toBe(2.5);
    expect(coerceParamValue("float", "1e309")).toBe("1e309");
  });

  it("passes empty input and non-numeric param types through", () => {
    expect(coerceParamValue("int", "")).toBe("");
    expect(coerceParamValue("float", "")).toBe("");
    expect(coerceParamValue("float", "  ")).toBe("");
    expect(coerceParamValue("string", "abc")).toBe("abc");
  });
});
