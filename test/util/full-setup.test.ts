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

const allRecommended = (ids: string[]) =>
  [{ id: "all_recommended", name: "x", component_ids: ids }] as never;

describe("boardOffersFullSetup", () => {
  it("is true only for a full-config board with an all_recommended bundle", () => {
    expect(
      boardOffersFullSetup(
        board({ full_config: true, featured_bundles: allRecommended(["a", "b"]) })
      )
    ).toBe(true);
    // Full config but no synthesized bundle (a chained curated bundle covered
    // it) → not offered as one click.
    expect(
      boardOffersFullSetup(
        board({ full_config: true, featured_components: [{ id: "a" }] as never })
      )
    ).toBe(false);
    // Has the bundle but isn't a full config → never offered.
    expect(
      boardOffersFullSetup(board({ featured_bundles: allRecommended(["a", "b"]) }))
    ).toBe(false);
    expect(boardOffersFullSetup(null)).toBe(false);
  });
});

describe("fullSetupComponentIds", () => {
  it("returns the all_recommended bundle's order", () => {
    const b = board({ featured_bundles: allRecommended(["c", "a", "b"]) });
    expect(fullSetupComponentIds(b)).toEqual(["c", "a", "b"]);
  });

  it("returns empty when there is no all_recommended bundle", () => {
    const b = board({
      featured_bundles: [{ id: "light_setup", name: "x", component_ids: ["a"] }] as never,
    });
    expect(fullSetupComponentIds(b)).toEqual([]);
  });
});
