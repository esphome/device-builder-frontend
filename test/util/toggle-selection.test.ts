import { describe, expect, it } from "vitest";
import { toggleSelection } from "../../src/util/toggle-selection.js";

describe("toggleSelection", () => {
  it("appends an id on select", () => {
    expect(toggleSelection(["a"], "b", true)).toEqual(["a", "b"]);
  });

  it("returns the input array unchanged when selecting a present id", () => {
    const selected = ["a", "b"];
    expect(toggleSelection(selected, "b", true)).toBe(selected);
  });

  it("removes an id on deselect", () => {
    expect(toggleSelection(["a", "b"], "a", false)).toEqual(["b"]);
  });

  it("returns the input array unchanged when deselecting an absent id", () => {
    const selected = ["a"];
    expect(toggleSelection(selected, "x", false)).toBe(selected);
  });

  it("does not mutate the input", () => {
    const selected = ["a", "b"];
    toggleSelection(selected, "c", true);
    toggleSelection(selected, "a", false);
    expect(selected).toEqual(["a", "b"]);
  });
});
