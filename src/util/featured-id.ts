import type { BoardCatalogEntry, FeaturedComponent } from "../api/types/boards.js";

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

/**
 * The featured entry a YAML instance materializes, or null.

 * Matches by section (``component_id``) plus the instance's emitted
 * ``id`` against the entry's ``id`` preset — the per-instance
 * counterpart to the pin guard's physical per-GPIO matching.
 */
export function featuredEntryForInstance(
  board: BoardCatalogEntry | null,
  sectionKey: string,
  instanceId: unknown
): FeaturedComponent | null {
  if (!board || !sectionKey || typeof instanceId !== "string") return null;
  return (
    board.featured_components?.find(
      (fc) => fc.component_id === sectionKey && fc.fields.id?.value === instanceId
    ) ?? null
  );
}

/**
 * Display name for a featured entry, mirroring the backend's
 * ``_featured_display_name`` so every surface names the entry the same
 * way: manifest ``name`` override, preset entity name (``fields.name``),
 * then *fallback* suffixed with the preset id ("SPI Bus (lcd_spi)").
 */
export function featuredDisplayName(fc: FeaturedComponent, fallback: string): string {
  if (fc.name) return fc.name;
  const namePreset = fc.fields.name?.value;
  if (typeof namePreset === "string" && namePreset) return namePreset;
  const idPreset = fc.fields.id?.value;
  if (typeof idPreset === "string" && idPreset) return `${fallback} (${idPreset})`;
  return fallback;
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
