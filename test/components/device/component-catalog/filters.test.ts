import { describe, expect, it } from "vitest";
import type { ComponentCatalogEntry } from "../../../../src/api/types/components.js";
import type { ESPHomeComponentCatalog } from "../../../../src/components/device/component-catalog.js";
import { visibleComponents } from "../../../../src/components/device/component-catalog/filters.js";

function entry(
  id: string,
  supported_platforms: string[] = [],
  dependencies: string[] = []
): ComponentCatalogEntry {
  return {
    id,
    multi_conf: true,
    dependencies,
    supported_platforms,
  } as unknown as ComponentCatalogEntry;
}

function host(
  components: ComponentCatalogEntry[],
  platform: string,
  lockedCategories: string[] = []
): ESPHomeComponentCatalog {
  return {
    _components: components,
    platform,
    yaml: "",
    lockedCategories,
  } as unknown as ESPHomeComponentCatalog;
}

describe("visibleComponents platform gate", () => {
  const components = [
    entry("async_tcp"), // no constraint
    entry("esp32", ["esp32"]),
    entry("bk72xx", ["bk72xx"]),
  ];

  it("drops components restricted to other platforms", () => {
    const ids = visibleComponents(host(components, "esp32")).map((c) => c.id);
    expect(ids).toEqual(["async_tcp", "esp32"]);
  });

  it("keeps everything when the platform is unknown", () => {
    const ids = visibleComponents(host(components, "")).map((c) => c.id);
    expect(ids).toEqual(["async_tcp", "esp32", "bk72xx"]);
  });

  it("keeps a bk72xx component for a bk72xx board", () => {
    const ids = visibleComponents(host(components, "bk72xx")).map((c) => c.id);
    expect(ids).toEqual(["async_tcp", "bk72xx"]);
  });

  it("does not count a platform-incompatible dep as satisfied when core-locked", () => {
    // The variant's only dep is hidden by the platform gate, so it can't be
    // satisfied from this dialog and the variant must drop too.
    const locked = [
      entry("dep.bk72xx", ["bk72xx"]),
      entry("time.foo", [], ["dep.bk72xx"]),
    ];
    const ids = visibleComponents(host(locked, "esp32", ["core"])).map((c) => c.id);
    expect(ids).toEqual([]);
  });
});
