import { describe, expect, it } from "vitest";
import type { BoardCatalogEntry } from "../../src/api/types/boards.js";
import {
  boardOffersFullSetup,
  featuredComponentName,
  fullSetupComponentIds,
} from "../../src/util/full-setup.js";

function board(flags: Partial<BoardCatalogEntry>): BoardCatalogEntry {
  return {
    id: "b",
    name: "Board",
    featured_components: [],
    featured_bundles: [],
    ...flags,
  } as unknown as BoardCatalogEntry;
}

const allRecommended = (ids: string[]) =>
  [{ id: "all_recommended", name: "x", component_ids: ids }] as never;

const components = (ids: string[]) => ids.map((id) => ({ id })) as never;

describe("boardOffersFullSetup", () => {
  it("is true for a full-config board with an all_recommended bundle", () => {
    expect(
      boardOffersFullSetup(
        board({ full_config: true, featured_bundles: allRecommended(["a", "b"]) })
      )
    ).toBe(true);
    // Has the bundle but isn't a full config → never offered.
    expect(
      boardOffersFullSetup(board({ featured_bundles: allRecommended(["a", "b"]) }))
    ).toBe(false);
    expect(boardOffersFullSetup(null)).toBe(false);
  });

  it("is true when an importer-derived bundle already covers every featured component", () => {
    // The ALD295HA shape: full_config, no all_recommended, one bundle whose
    // component_ids cover all featured components (backend skipped synthesis).
    expect(
      boardOffersFullSetup(
        board({
          full_config: true,
          featured_components: components(["hub", "out", "light"]),
          featured_bundles: [
            { id: "light_setup", name: "x", component_ids: ["hub", "out", "light"] },
          ] as never,
        })
      )
    ).toBe(true);
  });

  it("covers a single featured component (no over-broad >=2 guard)", () => {
    expect(
      boardOffersFullSetup(
        board({
          full_config: true,
          featured_components: components(["only"]),
          featured_bundles: [
            { id: "setup", name: "x", component_ids: ["only"] },
          ] as never,
        })
      )
    ).toBe(true);
  });

  it("is false when the featured set is empty (no vacuous bundle match)", () => {
    expect(
      boardOffersFullSetup(
        board({
          full_config: true,
          featured_bundles: [{ id: "stray", name: "x", component_ids: ["a"] }] as never,
        })
      )
    ).toBe(false);
  });

  it("is false when no bundle covers the full featured set", () => {
    // A partial bundle that misses a featured component → no blind apply.
    expect(
      boardOffersFullSetup(
        board({
          full_config: true,
          featured_components: components(["hub", "out", "light"]),
          featured_bundles: [
            { id: "partial", name: "x", component_ids: ["hub", "out"] },
          ] as never,
        })
      )
    ).toBe(false);
  });
});

describe("fullSetupComponentIds", () => {
  it("returns the all_recommended bundle's order", () => {
    const b = board({ featured_bundles: allRecommended(["c", "a", "b"]) });
    expect(fullSetupComponentIds(b)).toEqual(["c", "a", "b"]);
  });

  it("prefers all_recommended over a covering bundle", () => {
    const b = board({
      featured_components: components(["a", "b"]),
      featured_bundles: [
        { id: "light_setup", name: "x", component_ids: ["a", "b"] },
        { id: "all_recommended", name: "x", component_ids: ["b", "a"] },
      ] as never,
    });
    expect(fullSetupComponentIds(b)).toEqual(["b", "a"]);
  });

  it("returns the covering bundle's dependency order when there is no all_recommended", () => {
    const b = board({
      featured_components: components(["light", "hub", "out"]),
      featured_bundles: [
        { id: "light_setup", name: "x", component_ids: ["hub", "out", "light"] },
      ] as never,
    });
    expect(fullSetupComponentIds(b)).toEqual(["hub", "out", "light"]);
  });

  it("returns empty when no bundle covers the featured set", () => {
    const b = board({
      featured_components: components(["a", "b"]),
      featured_bundles: [{ id: "partial", name: "x", component_ids: ["a"] }] as never,
    });
    expect(fullSetupComponentIds(b)).toEqual([]);
  });
});

describe("featuredComponentName", () => {
  it("prefers name, then component_id, then the raw local id", () => {
    const b = board({
      featured_components: [
        { id: "eth", name: "Onboard Ethernet", component_id: "ethernet" },
        { id: "bus", component_id: "i2c" },
        { id: "bare" },
      ] as never,
    });
    expect(featuredComponentName(b, "eth")).toBe("Onboard Ethernet");
    expect(featuredComponentName(b, "bus")).toBe("i2c");
    expect(featuredComponentName(b, "bare")).toBe("bare");
    // Unknown local id falls back to itself.
    expect(featuredComponentName(b, "nope")).toBe("nope");
  });
});
