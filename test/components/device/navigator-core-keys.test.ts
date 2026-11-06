import { describe, expect, it } from "vitest";
import type { ComponentCatalogIndexEntry } from "../../../src/api/types/components.js";
import {
  deriveNavigatorBuckets,
  navigatorCoreKeys,
} from "../../../src/components/device/navigator-buckets.js";
import type { CatalogIndex } from "../../../src/util/yaml-completion-catalog.js";
import { CORE_KEYS } from "../../../src/util/yaml-sections.js";

function catalog(entries: Array<[string, string]>): CatalogIndex {
  const components = entries.map(
    ([id, category]) => ({ id, category }) as ComponentCatalogIndexEntry
  );
  const byCategory = new Map<string, ComponentCatalogIndexEntry[]>();
  for (const c of components) {
    byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c]);
  }
  return { components, byId: new Map(components.map((c) => [c.id, c])), byCategory };
}

describe("navigatorCoreKeys", () => {
  it("falls back to CORE_KEYS before the catalog loads", () => {
    expect(navigatorCoreKeys(null)).toBe(CORE_KEYS);
  });

  it("adds core-category domains and skips other categories", () => {
    const keys = navigatorCoreKeys(
      catalog([
        ["future_core", "core"],
        ["ota.esphome", "ota"],
        ["sensor.dht", "sensor"],
      ])
    );
    expect(keys.has("future_core")).toBe(true);
    expect(keys.has("ota")).toBe(true);
    expect(keys.has("sensor")).toBe(false);
    expect(keys.has("esphome")).toBe(true);
  });

  it("moves a catalog-only core key into the core bucket", () => {
    const yaml = "future_core:\nsensor:\n  - platform: dht\n";
    const keys = navigatorCoreKeys(catalog([["future_core", "core"]]));
    const { core, components } = deriveNavigatorBuckets(yaml, keys);
    expect(core.map((s) => s.key)).toEqual(["future_core"]);
    expect(components.map((s) => s.key)).toEqual(["sensor"]);
  });
});
