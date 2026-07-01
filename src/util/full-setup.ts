import type { BoardCatalogEntry, FeaturedBundle } from "../api/types/boards.js";

/** Local id of the all-recommended bundle the backend synthesizes (see #1726). */
const ALL_RECOMMENDED_BUNDLE_ID = "all_recommended";

/**
 * The board's dependency-ordered full-setup bundle, or null.
 *
 * Prefers the synthesized ``all_recommended``; otherwise an importer-derived
 * bundle that already covers every featured component — the backend skips
 * synthesizing ``all_recommended`` in that case (sync_boards coverage check),
 * so the existing covering bundle is the canonical full setup.
 */
function fullSetupBundle(board: BoardCatalogEntry): FeaturedBundle | null {
  const synthesized = board.featured_bundles.find(
    (b) => b.id === ALL_RECOMMENDED_BUNDLE_ID
  );
  if (synthesized) return synthesized;
  const featuredIds = board.featured_components.map((c) => c.id);
  // every() is vacuously true on an empty set; without this a board with no
  // featured components would match an arbitrary bundle.
  if (featuredIds.length === 0) return null;
  return (
    board.featured_bundles.find((b) => {
      const members = new Set(b.component_ids);
      return featuredIds.every((id) => members.has(id));
    }) ?? null
  );
}

/**
 * Whether the create wizard should offer a "set up with everything" choice.
 *
 * Only when the board is a complete onboard config (``full_config``) and a
 * single dependency-ordered bundle covers every featured component. Boards
 * whose recommended set is split across partial bundles aren't offered the
 * one-click setup (it would add components out of order); they use the Add
 * Component dialog.
 */
export function boardOffersFullSetup(board: BoardCatalogEntry | null): boolean {
  return !!board?.full_config && fullSetupBundle(board) !== null;
}

/** The featured local ids to add for a board's full setup, dependency-ordered. */
export function fullSetupComponentIds(board: BoardCatalogEntry): string[] {
  return fullSetupBundle(board)?.component_ids ?? [];
}

/** Display name for a board's featured local id, falling back to the id. */
export function featuredComponentName(board: BoardCatalogEntry, localId: string): string {
  const featured = board.featured_components.find((c) => c.id === localId);
  return featured?.name || featured?.component_id || localId;
}
