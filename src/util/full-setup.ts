import type { BoardCatalogEntry } from "../api/types/boards.js";

/** Local id of the all-recommended bundle the backend synthesizes (see #1726). */
const ALL_RECOMMENDED_BUNDLE_ID = "all_recommended";

/**
 * Whether the create wizard should offer a "set up with everything" choice:
 * the board is a complete onboard config with recommended components to add.
 */
export function boardOffersFullSetup(board: BoardCatalogEntry | null): boolean {
  return !!board?.full_config && board.featured_components.length > 0;
}

/**
 * The featured local ids to add for a board's full setup, dependency-ordered.
 *
 * Reuses the backend's synthesized ``all_recommended`` bundle when present (its
 * member order is authoritative); falls back to every featured component when a
 * curated bundle already covered them all and synthesis was skipped.
 */
export function fullSetupComponentIds(board: BoardCatalogEntry): string[] {
  const bundle = board.featured_bundles.find((b) => b.id === ALL_RECOMMENDED_BUNDLE_ID);
  if (bundle) return bundle.component_ids;
  return board.featured_components.map((fc) => fc.id);
}
