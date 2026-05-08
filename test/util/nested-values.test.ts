import { describe, expect, it } from "vitest";
import {
  getIn,
  isPlainObject,
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

  it("replaces the whole object when the path is empty", () => {
    // Empty path is the "this entry IS the whole values dict"
    // signal used by top-level user-keyed sections
    // (substitutions:). Value must be object-shaped; the function
    // coerces non-objects to an empty object so the caller's
    // ``Record<string, unknown>`` contract holds.
    expect(setIn({ a: 1 }, [], { b: 2 })).toEqual({ b: 2 });
    expect(setIn({ a: 1 }, [], {})).toEqual({});
  });

  it("coerces non-object values to {} when replacing on empty path", () => {
    expect(setIn({ a: 1 }, [], 99)).toEqual({});
    expect(setIn({ a: 1 }, [], null)).toEqual({});
    expect(setIn({ a: 1 }, [], "wat")).toEqual({});
    expect(setIn({ a: 1 }, [], [1, 2])).toEqual({});
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

describe("isPlainObject", () => {
  it("accepts plain objects (the deep-merge target shape)", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
  });

  it("rejects null and undefined", () => {
    // ``setIn`` and the pin renderer both treat null/undefined as
    // "no existing object — start fresh". The check has to be
    // explicit because ``typeof null === 'object'``.
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject(undefined)).toBe(false);
  });

  it("rejects primitives", () => {
    expect(isPlainObject("hello")).toBe(false);
    expect(isPlainObject("")).toBe(false);
    expect(isPlainObject(0)).toBe(false);
    expect(isPlainObject(true)).toBe(false);
  });

  it("rejects arrays", () => {
    // The pin renderer's long-form detection has to exclude arrays
    // — ``pin: [GPIO5]`` is invalid YAML for an ESPHome pin field
    // (and ``setIn`` treats arrays as "non-object child, replace
    // with {}"), so descending into one would be wrong either way.
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject([1, 2, 3])).toBe(false);
  });

  it("narrows the type for the caller", () => {
    const value: unknown = { a: 1 };
    if (isPlainObject(value)) {
      // ``value`` is now ``Record<string, unknown>`` — TypeScript
      // accepts ``value.a`` without a cast.
      expect(value.a).toBe(1);
    }
  });
});
