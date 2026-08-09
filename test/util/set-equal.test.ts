import { describe, expect, it } from "vitest";
import { arraysEqual, setsEqual } from "../../src/util/set-equal.js";

describe("setsEqual", () => {
  it("matches sets regardless of insertion order", () => {
    expect(setsEqual(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(setsEqual(new Set(), new Set())).toBe(true);
  });

  it("rejects a size mismatch and a same-size membership mismatch", () => {
    expect(setsEqual(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    expect(setsEqual(new Set(["a", "c"]), new Set(["a", "b"]))).toBe(false);
  });
});

describe("arraysEqual", () => {
  it("matches same items in the same order", () => {
    expect(arraysEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(arraysEqual([], [])).toBe(true);
  });

  it("rejects a length mismatch, an element mismatch, and reordering", () => {
    expect(arraysEqual(["a"], ["a", "b"])).toBe(false);
    expect(arraysEqual(["a", "c"], ["a", "b"])).toBe(false);
    expect(arraysEqual(["a", "b"], ["b", "a"])).toBe(false);
  });

  it("compares elements with the supplied comparator", () => {
    const byId = (x: { id: number }, y: { id: number }) => x.id === y.id;
    expect(arraysEqual([{ id: 1 }], [{ id: 1 }], byId)).toBe(true);
    expect(arraysEqual([{ id: 1 }], [{ id: 2 }], byId)).toBe(false);
  });
});
