import type { BoardCatalogEntry, FeaturedBundle } from "../api/types/boards.js";

/** Local id of the all-recommended bundle the backend synthesizes (see #1726). */
const ALL_RECOMMENDED_BUNDLE_ID = "all_recommended";

/** The backend-synthesized dependency-ordered full-setup bundle, or null. */
function allRecommendedBundle(board: BoardCatalogEntry): FeaturedBundle | null {
  return board.featured_bundles.find((b) => b.id === ALL_RECOMMENDED_BUNDLE_ID) ?? null;
}

/**
 * Whether the create wizard should offer a "set up with everything" choice.
 *
 * Only when the board is a complete onboard config (``full_config``) AND the
 * backend synthesized an ``all_recommended`` bundle — i.e. there's a single
 * dependency-ordered list to apply. Boards whose recommended set is only
 * reachable through a chained curated bundle aren't offered the one-click setup
 * (it would add components out of order); they use the Add Component dialog.
 */
export function boardOffersFullSetup(board: BoardCatalogEntry | null): boolean {
  return !!board?.full_config && allRecommendedBundle(board) !== null;
}

/** The featured local ids to add for a board's full setup, dependency-ordered. */
export function fullSetupComponentIds(board: BoardCatalogEntry): string[] {
  return allRecommendedBundle(board)?.component_ids ?? [];
}
