import { describe, expect, it } from "vitest";
import type { BoardCatalogEntry } from "../../src/api/types/boards.js";
import {
  boardOffersFullSetup,
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

describe("boardOffersFullSetup", () => {
  it("is true only for a full-config board with recommended components", () => {
    expect(
      boardOffersFullSetup(
        board({ full_config: true, featured_components: [{ id: "a" }] as never })
      )
    ).toBe(true);
    // No recommended components → nothing to set up.
    expect(boardOffersFullSetup(board({ full_config: true }))).toBe(false);
    // Optional-component board (not a full config) → never offered.
    expect(
      boardOffersFullSetup(
        board({ full_config: false, featured_components: [{ id: "a" }] as never })
      )
    ).toBe(false);
    expect(boardOffersFullSetup(null)).toBe(false);
  });
});

describe("fullSetupComponentIds", () => {
  it("uses the synthesized all_recommended bundle's order when present", () => {
    const b = board({
      featured_components: [{ id: "a" }, { id: "b" }, { id: "c" }] as never,
      featured_bundles: [
        { id: "all_recommended", name: "x", component_ids: ["c", "a", "b"] },
      ] as never,
    });
    expect(fullSetupComponentIds(b)).toEqual(["c", "a", "b"]);
  });

  it("falls back to every featured component when no all_recommended bundle exists", () => {
    const b = board({
      featured_components: [{ id: "a" }, { id: "b" }] as never,
      featured_bundles: [
        { id: "light_setup", name: "x", component_ids: ["a", "b"] },
      ] as never,
    });
    expect(fullSetupComponentIds(b)).toEqual(["a", "b"]);
  });
});
