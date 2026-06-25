/** The `featured.<board>.<local>` id prefix marking a board-curated preset entry. */
export const FEATURED_ID_PREFIX = "featured.";

/** True for a catalog id carrying the `featured.` prefix (the `featured.<board>.<local>` shape). */
export function isFeaturedId(id: string): boolean {
  return id.startsWith(FEATURED_ID_PREFIX);
}
