import { describe, expect, it } from "vitest";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { sameEntryShape } from "../../src/util/config-entry-shape.js";
import { makeConfigEntry } from "./_make-config-entry.js";

const entry = (key: string, type = ConfigEntryType.STRING) =>
  makeConfigEntry({ key, type, label: key });

describe("sameEntryShape", () => {
  it("matches a rebuilt list of the same fields", () => {
    expect(sameEntryShape([entry("a"), entry("b")], [entry("a"), entry("b")])).toBe(true);
  });

  it("matches two empty lists", () => {
    expect(sameEntryShape([], [])).toBe(true);
  });

  it.each([
    ["a different key", [entry("a")], [entry("b")]],
    ["a different type", [entry("a")], [entry("a", ConfigEntryType.FLOAT)]],
    ["a different length", [entry("a")], [entry("a"), entry("b")]],
    ["a different order", [entry("a"), entry("b")], [entry("b"), entry("a")]],
  ])("differs on %s", (_label, a, b) => {
    expect(sameEntryShape(a, b)).toBe(false);
  });
});
