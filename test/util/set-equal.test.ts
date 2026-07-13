import { describe, expect, it } from "vitest";
import { setsEqual } from "../../src/util/set-equal.js";

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
