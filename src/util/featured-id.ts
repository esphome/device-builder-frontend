/** The `featured.<board>.<local>` id prefix marking a board-curated preset entry. */
export const FEATURED_ID_PREFIX = "featured.";

/** Compose the catalog id for a board's featured entry from its board and local ids. */
export function buildFeaturedId(boardId: string, localId: string): string {
  return `${FEATURED_ID_PREFIX}${boardId}.${localId}`;
}

/** True when a catalog id carries the `featured.` prefix; only the prefix is checked, not the full shape. */
export function isFeaturedId(id: string): boolean {
  return id.startsWith(FEATURED_ID_PREFIX);
}
