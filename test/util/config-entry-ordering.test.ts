import { describe, expect, it } from "vitest";
import { makeConfigEntry } from "../../src/util/config-entry-defaults.js";
import { floatRequiredFirst } from "../../src/util/config-entry-ordering.js";

const keys = (entries: { key: string }[]) => entries.map((e) => e.key);

describe("floatRequiredFirst", () => {
  it("floats required entries above optional ones", () => {
    const entries = [
      makeConfigEntry({ key: "opt_a", required: false }),
      makeConfigEntry({ key: "req_a", required: true }),
      makeConfigEntry({ key: "opt_b", required: false }),
      makeConfigEntry({ key: "req_b", required: true }),
    ];
    expect(keys(floatRequiredFirst(entries))).toEqual([
      "req_a",
      "req_b",
      "opt_a",
      "opt_b",
    ]);
  });

  it("is stable within each partition (catalog order preserved)", () => {
    const entries = [
      makeConfigEntry({ key: "req_1", required: true }),
      makeConfigEntry({ key: "req_2", required: true }),
      makeConfigEntry({ key: "opt_1", required: false }),
      makeConfigEntry({ key: "opt_2", required: false }),
    ];
    // Already-sorted input must come back unchanged.
    expect(keys(floatRequiredFirst(entries))).toEqual([
      "req_1",
      "req_2",
      "opt_1",
      "opt_2",
    ]);
  });

  it("floats an entire exclusive_group when any member is required", () => {
    const entries = [
      makeConfigEntry({ key: "opt", required: false }),
      makeConfigEntry({ key: "g_optional", required: false, exclusive_group: "g" }),
      makeConfigEntry({ key: "g_required", required: true, exclusive_group: "g" }),
    ];
    // ``g_optional`` floats alongside ``g_required`` because the group is
    // rendered as one dropdown; splitting it across the boundary would be wrong.
    expect(keys(floatRequiredFirst(entries))).toEqual([
      "g_optional",
      "g_required",
      "opt",
    ]);
  });

  it("keeps an all-optional exclusive_group below required singletons", () => {
    const entries = [
      makeConfigEntry({ key: "g_a", required: false, exclusive_group: "g" }),
      makeConfigEntry({ key: "g_b", required: false, exclusive_group: "g" }),
      makeConfigEntry({ key: "req", required: true }),
    ];
    expect(keys(floatRequiredFirst(entries))).toEqual(["req", "g_a", "g_b"]);
  });

  it("returns a new array without mutating the input", () => {
    const entries = [
      makeConfigEntry({ key: "opt", required: false }),
      makeConfigEntry({ key: "req", required: true }),
    ];
    const result = floatRequiredFirst(entries);
    expect(result).not.toBe(entries);
    expect(keys(entries)).toEqual(["opt", "req"]);
  });

  it("returns an empty array for empty input", () => {
    expect(floatRequiredFirst([])).toEqual([]);
  });
});
