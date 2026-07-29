/** Unit tests for `advancedGated`. */
import { describe, expect, it } from "vitest";

import { advancedGated } from "../../src/util/material-value.js";
import { makeConfigEntry, makeNestedEntry } from "./_make-config-entry.js";

describe("advancedGated", () => {
  it("gates an advanced entry without a value", () => {
    expect(advancedGated(makeConfigEntry({ key: "a", advanced: true }), {})).toBe(true);
  });

  it("does not gate a valued advanced entry", () => {
    expect(advancedGated(makeConfigEntry({ key: "a", advanced: true }), { a: "x" })).toBe(
      false
    );
  });

  it("never gates a plain entry", () => {
    expect(advancedGated(makeConfigEntry({ key: "a" }), {})).toBe(false);
  });

  it("follows hasMaterialValue into nested children", () => {
    const nested = {
      ...makeNestedEntry("grp", [makeConfigEntry({ key: "child" })]),
      advanced: true,
    };
    expect(advancedGated(nested, { grp: { child: 1 } })).toBe(false);
    expect(advancedGated(nested, {})).toBe(true);
  });
});
