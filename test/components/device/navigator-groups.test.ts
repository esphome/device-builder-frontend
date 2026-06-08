import { describe, expect, it } from "vitest";

import { groupRowsByDomain } from "../../../src/components/device/navigator-groups.js";
import type { NavRow } from "../../../src/components/device/navigator-labels.js";
import type { YamlSection } from "../../../src/util/yaml-sections.js";

const row = (key: string, fromLine: number): NavRow => ({
  item: { key, fromLine } as unknown as YamlSection,
  labels: { primary: key },
});

describe("groupRowsByDomain", () => {
  it("groups by domain in first-appearance order, keeping row order", () => {
    const groups = groupRowsByDomain([
      row("sensor", 1),
      row("switch", 2),
      row("sensor", 3),
      row("number", 4),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["sensor", "switch", "number"]);
    expect(groups[0].rows.map((r) => r.item.fromLine)).toEqual([1, 3]);
  });

  it("returns an empty list for no rows", () => {
    expect(groupRowsByDomain([])).toEqual([]);
  });
});
