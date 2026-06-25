/** The `featured.<board>.<local>` id prefix marking a board-curated preset entry. */
export const FEATURED_ID_PREFIX = "featured.";

/** True when a catalog id carries the `featured.` prefix; only the prefix is checked, not the full shape. */
export function isFeaturedId(id: string): boolean {
  return id.startsWith(FEATURED_ID_PREFIX);
}
