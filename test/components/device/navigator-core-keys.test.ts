import { describe, expect, it } from "vitest";
import type { ComponentCatalogIndexEntry } from "../../../src/api/types/components.js";
import { deriveNavigatorBuckets } from "../../../src/components/device/navigator-buckets.js";
import type { CatalogIndex } from "../../../src/util/yaml-completion-catalog.js";
import { catalogCoreKeys, CORE_KEYS } from "../../../src/util/yaml-sections.js";
import { makeComponentEntry } from "../../util/_make-component-entry.js";

function catalog(entries: Array<[string, string]>): CatalogIndex {
  const components: ComponentCatalogIndexEntry[] = entries.map(([id, category]) =>
    makeComponentEntry(id, { category })
  );
  const byCategory = new Map<string, ComponentCatalogIndexEntry[]>();
  for (const c of components) {
    byCategory.set(c.category, [...(byCategory.get(c.category) ?? []), c]);
  }
  return { components, byId: new Map(components.map((c) => [c.id, c])), byCategory };
}

describe("catalogCoreKeys", () => {
  it("falls back to CORE_KEYS before the catalog loads", () => {
    expect(catalogCoreKeys(null)).toBe(CORE_KEYS);
  });

  it("adds core-category domains and skips other categories", () => {
    const keys = catalogCoreKeys(
      catalog([
        ["http_request", "core"],
        ["ota.esphome", "ota"],
        ["sensor.dht", "sensor"],
      ])
    );
    expect(keys.has("http_request")).toBe(true);
    expect(keys.has("ota")).toBe(true);
    expect(keys.has("sensor")).toBe(false);
    expect(keys.has("esphome")).toBe(true);
  });

  it("moves a catalog core component into the core bucket", () => {
    const yaml = "http_request:\nsensor:\n  - platform: dht\n";
    const keys = catalogCoreKeys(catalog([["http_request", "core"]]));
    const { core, components } = deriveNavigatorBuckets(yaml, keys);
    expect(core.map((s) => s.key)).toEqual(["http_request"]);
    expect(components.map((s) => s.key)).toEqual(["sensor"]);
  });
});
