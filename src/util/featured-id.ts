/** The `featured.<board>.<local>` id prefix marking a board-curated preset entry. */
export const FEATURED_ID_PREFIX = "featured.";

/** The minimal board shape the resolver needs (any `BoardCatalogEntry` fits). */
type FeaturedIdBoard = {
  id: string;
  featured_components?: ReadonlyArray<{ id: string; component_id: string }>;
};

/** Compose the catalog id for a board's featured entry from its board and local ids. */
export function buildFeaturedId(boardId: string, localId: string): string {
  return `${FEATURED_ID_PREFIX}${boardId}.${localId}`;
}

/** True when a catalog id carries the `featured.` prefix; only the prefix is checked, not the full shape. */
export function isFeaturedId(id: string): boolean {
  return id.startsWith(FEATURED_ID_PREFIX);
}

/** Resolve a featured catalog id to the component it actually adds; non-featured or unknown ids pass through. */
export function resolveFeaturedComponentId(
  id: string,
  board: FeaturedIdBoard | null
): string {
  if (!board || !isFeaturedId(id)) return id;
  const fc = (board.featured_components ?? []).find(
    (c) => buildFeaturedId(board.id, c.id) === id
  );
  return fc?.component_id ?? id;
}
