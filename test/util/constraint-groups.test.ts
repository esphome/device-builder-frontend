import { describe, expect, it } from "vitest";

import { evaluateGroup, stripConstraintProse } from "../../src/util/constraint-groups.js";

describe("evaluateGroup", () => {
  const v = (...present: string[]): Record<string, unknown> =>
    Object.fromEntries(present.map((k) => [k, "x"]));

  it("exactly_one holds for exactly one present member", () => {
    expect(evaluateGroup("exactly_one", ["a", "b"], v())).toBe(false);
    expect(evaluateGroup("exactly_one", ["a", "b"], v("a"))).toBe(true);
    expect(evaluateGroup("exactly_one", ["a", "b"], v("a", "b"))).toBe(false);
  });

  it("at_least_one holds for one or more", () => {
    expect(evaluateGroup("at_least_one", ["a", "b"], v())).toBe(false);
    expect(evaluateGroup("at_least_one", ["a", "b"], v("b"))).toBe(true);
    expect(evaluateGroup("at_least_one", ["a", "b"], v("a", "b"))).toBe(true);
  });

  it("at_most_one holds for zero or one", () => {
    expect(evaluateGroup("at_most_one", ["a", "b"], v())).toBe(true);
    expect(evaluateGroup("at_most_one", ["a", "b"], v("a"))).toBe(true);
    expect(evaluateGroup("at_most_one", ["a", "b"], v("a", "b"))).toBe(false);
  });

  it("none_or_all / all_or_none hold for zero or every member", () => {
    for (const kind of ["none_or_all", "all_or_none"] as const) {
      expect(evaluateGroup(kind, ["a", "b"], v())).toBe(true);
      expect(evaluateGroup(kind, ["a", "b"], v("a"))).toBe(false);
      expect(evaluateGroup(kind, ["a", "b"], v("a", "b"))).toBe(true);
    }
  });

  it("treats blank strings and empty arrays as not present", () => {
    expect(evaluateGroup("at_least_one", ["a"], { a: "" })).toBe(false);
    expect(evaluateGroup("at_least_one", ["a"], { a: "  " })).toBe(false);
    expect(evaluateGroup("at_least_one", ["a"], { a: [] })).toBe(false);
    expect(evaluateGroup("at_least_one", ["a"], { a: 0 })).toBe(true);
  });
});

describe("stripConstraintProse", () => {
  // The backend prepends bold constraint paragraphs to a member's description;
  // the form renders those reactively, so the static prose must be removed.
  it("drops the leading Required / Set-together paragraphs, keeps the rest", () => {
    const desc = [
      "**Required — set exactly one of:** `chipset`, `bit0_high`.",
      "**Set together with:** `bit0_low`, `bit1_high`, `bit1_low` (all-or-none).",
      "The time to hold the data line high for a 0 bit.",
    ].join("\n\n");
    expect(stripConstraintProse(desc)).toBe(
      "The time to hold the data line high for a 0 bit."
    );
  });

  it("strips the at-most-one and none-or-all variants", () => {
    expect(stripConstraintProse("**Set at most one of:** `a`, `b`.\n\nBody.")).toBe(
      "Body."
    );
    expect(
      stripConstraintProse(
        "**Set together — all of these must be set, or all left blank:** `a`.\n\nBody."
      )
    ).toBe("Body.");
  });

  it("leaves a description with no constraint prose untouched", () => {
    expect(stripConstraintProse("The number of LEDs in the strip.")).toBe(
      "The number of LEDs in the strip."
    );
  });

  it("returns empty when the description was only constraint prose", () => {
    expect(stripConstraintProse("**Required — set at least one of:** `a`, `b`.")).toBe(
      ""
    );
  });
});
