import { describe, expect, it } from "vitest";
import { ConfigEntryType } from "../../src/api/types/config-entries.js";
import { sameEntryTarget } from "../../src/util/config-entry-target.js";
import { makeConfigEntry } from "./_make-config-entry.js";

const entry = (key: string, type = ConfigEntryType.STRING) =>
  makeConfigEntry({ key, type, label: key });

describe("sameEntryTarget", () => {
  it("matches a rebuilt array of the same entries", () => {
    const entries = [entry("a"), entry("b")];
    expect(sameEntryTarget(entries, [...entries])).toBe(true);
    expect(sameEntryTarget(entries, entries.filter(Boolean))).toBe(true);
  });

  it("matches two empty lists", () => {
    expect(sameEntryTarget([], [])).toBe(true);
  });

  it("matches a list section's wrapper rebuilt around the same children", () => {
    const children = [entry("id"), entry("type")];
    const wrap = () => [
      makeConfigEntry({
        key: "globals",
        type: ConfigEntryType.NESTED,
        multi_value: true,
        config_entries: children,
      }),
    ];
    expect(sameEntryTarget(wrap(), wrap())).toBe(true);
  });

  it("tells apart two definitions whose fields look alike", () => {
    expect(sameEntryTarget([entry("id")], [entry("id")])).toBe(false);
  });

  it("tells apart wrappers around different children", () => {
    const wrap = () => [
      makeConfigEntry({
        key: "globals",
        type: ConfigEntryType.NESTED,
        config_entries: [entry("id")],
      }),
    ];
    expect(sameEntryTarget(wrap(), wrap())).toBe(false);
  });

  it("differs on a different length", () => {
    const a = entry("a");
    expect(sameEntryTarget([a], [a, entry("b")])).toBe(false);
  });

  it("differs on a different order", () => {
    const [a, b] = [entry("a"), entry("b")];
    expect(sameEntryTarget([a, b], [b, a])).toBe(false);
  });
});
