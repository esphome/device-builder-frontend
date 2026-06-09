/**
 * Pins ``coerceIntFieldValue``: the shared decimal-or-hex normaliser used by
 * the integer renderer and the add-component coercer. Bare decimal becomes a
 * number; hex / anything else stays a verbatim string so 0x.. notation
 * survives (ESPHome's cv.int_ parses it) instead of being canonicalised or
 * truncated to 0 by parseInt(base 10).
 */
import { describe, expect, it } from "vitest";

import { coerceIntFieldValue, parseIntInput } from "../../src/util/int-input.js";

describe("coerceIntFieldValue", () => {
  it("turns a bare decimal into a number", () => {
    expect(coerceIntFieldValue("434343")).toBe(434343);
  });

  it("turns a negative decimal into a number", () => {
    expect(coerceIntFieldValue("-5")).toBe(-5);
  });

  it("keeps a hex literal verbatim (no canonicalisation, no parseInt truncation)", () => {
    expect(coerceIntFieldValue("0x1111")).toBe("0x1111");
    expect(coerceIntFieldValue("0X2A")).toBe("0X2A");
  });

  it("keeps junk verbatim for the validator to flag", () => {
    expect(coerceIntFieldValue("zzz")).toBe("zzz");
  });

  it("trims surrounding whitespace before classifying", () => {
    expect(coerceIntFieldValue("  4369  ")).toBe(4369);
  });

  it("keeps a 64-bit decimal as a string to preserve precision past 2^53", () => {
    // cv.uint64_t max; Number() would round it, corrupting the value.
    expect(coerceIntFieldValue("18446744073709551615")).toBe("18446744073709551615");
  });

  it("drops leading zeros on a safe int (avoids YAML octal ambiguity)", () => {
    expect(coerceIntFieldValue("0042")).toBe(42);
  });

  it("passes an existing number through unchanged", () => {
    expect(coerceIntFieldValue(118)).toBe(118);
  });

  it("returns empty string for blank / nullish input", () => {
    expect(coerceIntFieldValue("")).toBe("");
    expect(coerceIntFieldValue("   ")).toBe("");
    expect(coerceIntFieldValue(null)).toBe("");
    expect(coerceIntFieldValue(undefined)).toBe("");
  });
});

describe("parseIntInput", () => {
  it("parses bare decimal (incl. negative) to a BigInt", () => {
    expect(parseIntInput("4369")).toBe(4369n);
    expect(parseIntInput("-5")).toBe(-5n);
    expect(parseIntInput(118)).toBe(118n);
  });

  it("parses 0x hex (either case) to a BigInt", () => {
    expect(parseIntInput("0x1111")).toBe(4369n);
    expect(parseIntInput("0X2A")).toBe(42n);
    expect(parseIntInput("0xffffffffffffffff")).toBe(18446744073709551615n);
  });

  it("rejects forms cv.int_ does not accept", () => {
    // cv.int_ does int(value, 10) — these all raise there, so they must
    // not validate clean in the editor either.
    expect(parseIntInput("1e3")).toBeNull();
    expect(parseIntInput("1.5")).toBeNull();
    expect(parseIntInput("zzz")).toBeNull();
    expect(parseIntInput("-0x5")).toBeNull();
    expect(parseIntInput("")).toBeNull();
  });
});
