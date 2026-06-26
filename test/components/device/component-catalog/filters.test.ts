import { describe, expect, it } from "vitest";
import type { BoardCatalogEntry } from "../../../../src/api/types/boards.js";
import type { ComponentCatalogEntry } from "../../../../src/api/types/components.js";
import type { ESPHomeComponentCatalog } from "../../../../src/components/device/component-catalog.js";
import {
  availableFeaturedCount,
  buildCategories,
  visibleComponents,
} from "../../../../src/components/device/component-catalog/filters.js";

function entry(
  id: string,
  supported_platforms: string[] = [],
  dependencies: string[] = [],
  multi_conf = true
): ComponentCatalogEntry {
  return {
    id,
    multi_conf,
    dependencies,
    supported_platforms,
  } as unknown as ComponentCatalogEntry;
}

function host(
  components: ComponentCatalogEntry[],
  platform: string,
  {
    lockedCategories = [],
    yaml = "",
    board = null,
  }: {
    lockedCategories?: string[];
    yaml?: string;
    board?: BoardCatalogEntry | null;
  } = {}
): ESPHomeComponentCatalog {
  return {
    _components: components,
    platform,
    yaml,
    lockedCategories,
    board,
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
    const ids = visibleComponents(
      host(locked, "esp32", { lockedCategories: ["core"] })
    ).map((c) => c.id);
    expect(ids).toEqual([]);
  });
});

describe("visibleComponents featured present-filter", () => {
  const board = {
    id: "esp32-poe-iso",
    featured_components: [{ id: "onboard_ethernet", component_id: "ethernet" }],
  } as unknown as BoardCatalogEntry;
  const featured = entry("featured.esp32-poe-iso.onboard_ethernet", [], [], false);

  it("hides a featured single-instance component already in the YAML", () => {
    const ids = visibleComponents(
      host([featured], "esp32", { yaml: "ethernet:\n  type: LAN8720\n", board })
    ).map((c) => c.id);
    expect(ids).toEqual([]);
  });

  it("keeps the featured component when its target is not configured", () => {
    const ids = visibleComponents(host([featured], "esp32", { board })).map((c) => c.id);
    expect(ids).toEqual(["featured.esp32-poe-iso.onboard_ethernet"]);
  });

  it("keeps a multi-conf featured component whose target is already present", () => {
    // multi_conf components can be added repeatedly, so resolving the real id
    // must not hide them even when a matching block exists.
    const multiBoard = {
      id: "demo",
      featured_components: [{ id: "relay", component_id: "switch.gpio" }],
    } as unknown as BoardCatalogEntry;
    const multi = entry("featured.demo.relay", [], [], true);
    const ids = visibleComponents(
      host([multi], "esp32", { yaml: "switch:\n  - platform: gpio\n", board: multiBoard })
    ).map((c) => c.id);
    expect(ids).toEqual(["featured.demo.relay"]);
  });
});

describe("availableFeaturedCount", () => {
  const board = (
    featured_components: unknown[],
    featured_bundles: unknown[] = []
  ): BoardCatalogEntry =>
    ({ id: "b", featured_components, featured_bundles }) as unknown as BoardCatalogEntry;

  it("is 0 with no board", () => {
    expect(availableFeaturedCount(host([], "esp32"))).toBe(0);
  });

  it("drops a single-instance featured component already configured", () => {
    const b = board([{ id: "eth", component_id: "ethernet", multi_conf: false }]);
    expect(availableFeaturedCount(host([], "esp32", { board: b }))).toBe(1);
    expect(
      availableFeaturedCount(host([], "esp32", { yaml: "ethernet:\n", board: b }))
    ).toBe(0);
  });

  it("keeps a multi-conf featured component even when its domain is present", () => {
    const b = board([{ id: "relay", component_id: "switch.gpio", multi_conf: true }]);
    expect(
      availableFeaturedCount(
        host([], "esp32", { yaml: "switch:\n  - platform: gpio\n", board: b })
      )
    ).toBe(1);
  });

  it("treats a missing multi_conf as multi-conf (available)", () => {
    const b = board([{ id: "relay", component_id: "switch.gpio" }]);
    expect(
      availableFeaturedCount(
        host([], "esp32", { yaml: "switch:\n  - platform: gpio\n", board: b })
      )
    ).toBe(1);
  });

  it("counts bundles as-is (matching the grid), plus addable components", () => {
    const b = board(
      [
        { id: "eth", component_id: "ethernet", multi_conf: false },
        { id: "relay", component_id: "switch.gpio", multi_conf: true },
      ],
      [{ id: "kit", component_ids: ["eth", "relay"] }]
    );
    // ethernet present (dropped), relay addable (1), bundle always counts (1)
    expect(
      availableFeaturedCount(host([], "esp32", { yaml: "ethernet:\n", board: b }))
    ).toBe(2);
  });
});

describe("buildCategories Recommended collapse", () => {
  const localize = (k: string) => k;
  const hostWith = (
    board: BoardCatalogEntry | null,
    yaml: string,
    lockedCategories: string[] = []
  ) =>
    ({
      _categories: [{ id: "featured", count: 1 }],
      _total: 1,
      excludeCategories: [],
      lockedCategories,
      board,
      yaml,
    }) as unknown as ESPHomeComponentCatalog;
  const board = {
    id: "b",
    featured_components: [{ id: "eth", component_id: "ethernet", multi_conf: false }],
    featured_bundles: [],
  } as unknown as BoardCatalogEntry;

  it("omits the Featured row when nothing is available", () => {
    const ids = buildCategories(hostWith(board, "ethernet:\n"), localize).map(
      (c) => c.id
    );
    expect(ids).not.toContain("featured");
  });

  it("keeps the Featured row when a recommendation is available", () => {
    const cats = buildCategories(hostWith(board, ""), localize);
    const featured = cats.find((c) => c.id === "featured");
    expect(featured?.count).toBe(1);
  });

  it("omits the Featured row in locked-category mode", () => {
    const ids = buildCategories(hostWith(board, "", ["core"]), localize).map((c) => c.id);
    expect(ids).not.toContain("featured");
  });
});
