import { describe, expect, it } from "vitest";
import {
  ComponentCategory,
  type ComponentCatalogEntry,
} from "../../src/api/types.js";
import { buildTopLevelCompletions } from "../../src/util/yaml-completion.js";

type CatalogIndex = Parameters<typeof buildTopLevelCompletions>[0];

function entry(
  id: string,
  category: ComponentCategory,
): ComponentCatalogEntry {
  return {
    id,
    name: id,
    description: "",
    category,
    docs_url: "",
    image_url: "",
    dependencies: [],
    multi_conf: false,
    supported_platforms: [],
    config_entries: [],
  };
}

function catalog(entries: ComponentCatalogEntry[]): CatalogIndex {
  const byId = new Map<string, ComponentCatalogEntry>();
  const byCategory = new Map<string, ComponentCatalogEntry[]>();
  for (const e of entries) {
    byId.set(e.id, e);
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }
  return { components: entries, byId, byCategory };
}

describe("buildTopLevelCompletions", () => {
  it("includes platform-domain umbrellas extracted from categories", () => {
    // The catalog only carries dotted ids for platform implementations
    // — typing ``b`` at column 0 should still surface
    // ``binary_sensor`` (the YAML key the user actually types), not
    // ``binary_sensor.gpio`` / ``binary_sensor.apds9960`` (platform
    // values that belong INSIDE the block).
    const c = catalog([
      entry("binary_sensor.gpio", ComponentCategory.BINARY_SENSOR),
      entry("binary_sensor.apds9960", ComponentCategory.BINARY_SENSOR),
      entry("sensor.dht", ComponentCategory.SENSOR),
    ]);
    const labels = buildTopLevelCompletions(c).map((o) => o.label);
    expect(labels).toContain("binary_sensor");
    expect(labels).toContain("sensor");
    expect(labels).not.toContain("binary_sensor.gpio");
    expect(labels).not.toContain("binary_sensor.apds9960");
    expect(labels).not.toContain("sensor.dht");
  });

  it("includes standalone components with non-dotted ids", () => {
    const c = catalog([
      entry("wifi", ComponentCategory.CORE),
      entry("logger", ComponentCategory.CORE),
      entry("esphome", ComponentCategory.CORE),
    ]);
    const labels = buildTopLevelCompletions(c).map((o) => o.label);
    expect(labels.sort()).toEqual(["esphome", "logger", "wifi"]);
  });

  it("offers binary_sensor when typing 'b' / 'binary_'", () => {
    // User-reported regression: typing ``binary_sensor`` at top level
    // returned no completion. Pin the bare-domain entry so a future
    // refactor can't filter it out again.
    const c = catalog([
      entry("binary_sensor.gpio", ComponentCategory.BINARY_SENSOR),
      entry("bedjet", ComponentCategory.MISC),
    ]);
    const labels = buildTopLevelCompletions(c).map((o) => o.label);
    expect(labels).toContain("binary_sensor");
    // ``bedjet`` (non-dotted, MISC category) should appear as a
    // standalone component too.
    expect(labels).toContain("bedjet");
  });

  it("dedupes when both a domain umbrella and a component share a name", () => {
    // Defensive: a platform implementation in the BINARY_SENSOR
    // category and a hypothetical bare ``binary_sensor`` component
    // shouldn't double-count.
    const c = catalog([
      entry("binary_sensor.gpio", ComponentCategory.BINARY_SENSOR),
      entry("binary_sensor", ComponentCategory.BINARY_SENSOR),
    ]);
    const labels = buildTopLevelCompletions(c).map((o) => o.label);
    expect(labels.filter((l) => l === "binary_sensor").length).toBe(1);
  });

  it("emits a sensible apply snippet (key:\\n  ) for both shapes", () => {
    const c = catalog([
      entry("binary_sensor.gpio", ComponentCategory.BINARY_SENSOR),
      entry("wifi", ComponentCategory.CORE),
    ]);
    const out = buildTopLevelCompletions(c);
    const bs = out.find((o) => o.label === "binary_sensor")!;
    const wifi = out.find((o) => o.label === "wifi")!;
    expect(bs.apply).toBe("binary_sensor:\n  ");
    expect(wifi.apply).toBe("wifi:\n  ");
  });

  it("returns [] for an empty catalog", () => {
    expect(buildTopLevelCompletions(catalog([]))).toEqual([]);
  });
});
