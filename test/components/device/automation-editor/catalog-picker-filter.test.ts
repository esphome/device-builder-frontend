import { describe, expect, it } from "vitest";

import type { AutomationAction } from "../../../../src/api/types/automations.js";
import {
  filterItems,
  groupByDomain,
  itemsForDevice,
} from "../../../../src/components/device/automation-editor/catalog-picker-filter.js";

const item = (id: string, domain: string, description = ""): AutomationAction =>
  ({ id, name: id, domain, description }) as AutomationAction;

describe("catalog-picker-filter", () => {
  const generic = item("switch.turn_on", "switch");
  const gpioOnly = item("switch.gpio.pulse", "switch.gpio");
  const light = item("light.turn_on", "light");

  it("groupByDomain buckets in catalog order under the given key", () => {
    const groups = groupByDomain(
      [gpioOnly, generic, light],
      (i) => i.domain.split(".")[0]
    );
    expect([...groups.keys()]).toEqual(["switch", "light"]);
    expect(groups.get("switch")).toEqual([gpioOnly, generic]);
  });

  it("itemsForDevice lists bare-domain items, then the platform's own", () => {
    const byDomain = groupByDomain([gpioOnly, generic, light]);
    expect(itemsForDevice(byDomain, { component_id: "switch.gpio", id: "r1" })).toEqual([
      generic,
      gpioOnly,
    ]);
    expect(
      itemsForDevice(byDomain, { component_id: "switch.template", id: "r2" })
    ).toEqual([generic]);
    expect(itemsForDevice(byDomain, { component_id: "light", id: "l1" })).toEqual([
      light,
    ]);
  });

  it("filterItems matches id, name and description and passes through an empty query", () => {
    const glow = item("light.dim", "light", "Makes things glow");
    const items = [generic, glow];
    expect(filterItems(items, "")).toBe(items);
    expect(filterItems(items, "glow")).toEqual([glow]);
    expect(filterItems(items, "switch.turn")).toEqual([generic]);
    expect(filterItems(items, "zzz")).toEqual([]);
  });
});
