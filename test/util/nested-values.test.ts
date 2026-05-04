import { describe, expect, it } from "vitest";
import {
  getIn,
  isPrimitiveOrNullish,
  setIn,
} from "../../src/util/nested-values.js";

describe("setIn", () => {
  it("returns a fresh object with the leaf written", () => {
    const before = { a: 1, b: 2 };
    const after = setIn(before, ["b"], 99);
    expect(after).toEqual({ a: 1, b: 99 });
    // Structural sharing — caller can rely on identity to detect changes.
    expect(after).not.toBe(before);
  });

  it("creates intermediate objects across missing paths", () => {
    expect(setIn({}, ["a", "b", "c"], 1)).toEqual({
      a: { b: { c: 1 } },
    });
  });

  it("replaces non-object children when descending", () => {
    // ``a`` is a string, but the path wants ``a.b.c`` — replace.
    expect(setIn({ a: "hello" }, ["a", "b"], 1)).toEqual({
      a: { b: 1 },
    });
  });

  it("returns the input unchanged on an empty path", () => {
    const before = { a: 1 };
    expect(setIn(before, [], 99)).toBe(before);
  });
});

describe("getIn", () => {
  it("reads a leaf value", () => {
    expect(getIn({ a: { b: { c: 5 } } }, ["a", "b", "c"])).toBe(5);
  });

  it("returns undefined for a missing path", () => {
    expect(getIn({ a: 1 }, ["b"])).toBeUndefined();
    expect(getIn({ a: { b: 1 } }, ["a", "c"])).toBeUndefined();
  });

  it("returns undefined when the path crosses a non-object", () => {
    expect(getIn({ a: "hello" }, ["a", "b"])).toBeUndefined();
    expect(getIn({ a: [1, 2] }, ["a", "0"])).toBeUndefined();
  });
});

describe("isPrimitiveOrNullish", () => {
  it("accepts primitives and nullish", () => {
    expect(isPrimitiveOrNullish("hello")).toBe(true);
    expect(isPrimitiveOrNullish("")).toBe(true);
    expect(isPrimitiveOrNullish(0)).toBe(true);
    expect(isPrimitiveOrNullish(42)).toBe(true);
    expect(isPrimitiveOrNullish(true)).toBe(true);
    expect(isPrimitiveOrNullish(false)).toBe(true);
    expect(isPrimitiveOrNullish(null)).toBe(true);
    expect(isPrimitiveOrNullish(undefined)).toBe(true);
  });

  it("rejects plain objects (would stringify but still not primitive)", () => {
    expect(isPrimitiveOrNullish({})).toBe(false);
    expect(isPrimitiveOrNullish({ a: 1 })).toBe(false);
  });

  it("rejects null-prototype objects (the actual crash case)", () => {
    // ``Object.create(null)`` has no ``toString`` or
    // ``Symbol.toPrimitive`` — ``String(value)`` would throw.
    // Pinning this is the whole reason the helper exists.
    const noProto = Object.create(null);
    expect(isPrimitiveOrNullish(noProto)).toBe(false);
    expect(() => String(noProto)).toThrow(
      /Cannot convert object to primitive value/,
    );
  });

  it("rejects arrays, dates, maps, and other built-ins", () => {
    expect(isPrimitiveOrNullish([])).toBe(false);
    expect(isPrimitiveOrNullish([1, 2, 3])).toBe(false);
    expect(isPrimitiveOrNullish(new Date())).toBe(false);
    expect(isPrimitiveOrNullish(new Map())).toBe(false);
  });

  it("narrows the type for the caller", () => {
    const value: unknown = "hello";
    if (isPrimitiveOrNullish(value)) {
      // ``value`` is now ``string | number | boolean | null | undefined``
      // — TypeScript accepts ``String(value)`` without a cast.
      const s: string = String(value ?? "");
      expect(s).toBe("hello");
    }
  });
});
