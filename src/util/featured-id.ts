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
 * True for platform-shaped catalog ids ('switch.gpio'). A featured id
 * carries dots but wraps one underlying component, so it never reads
 * as a platform entry.
 */
export function isPlatformComponentId(id: string): boolean {
  return isFeaturedId(id) ? false : id.includes(".");
}

/**
 * The featured entry a YAML instance materializes, or null.

 * Matches by section (``component_id``) plus the instance's emitted
 * ``id`` against the entry's ``id`` preset — the per-instance
 * counterpart to the pin guard's physical per-GPIO matching. An entry
 * without an ``id`` preset matches by section alone, but only for a
 * single-instance component (ethernet's singleton wiring) — a
 * repeatable section's instance must match an ``id`` preset exactly,
 * or a hand-added sibling would borrow the entry's presets.
 */
export function featuredEntryForInstance(
  board: BoardCatalogEntry | null,
  sectionKey: string,
  instanceId: unknown
): FeaturedComponent | null {
  if (!board || !sectionKey) return null;
  const inSection =
    board.featured_components?.filter((fc) => fc.component_id === sectionKey) ?? [];
  return (
    inSection.find(
      (fc) =>
        fc.fields.id !== undefined &&
        typeof instanceId === "string" &&
        fc.fields.id.value === instanceId
    ) ??
    inSection.find((fc) => fc.fields.id === undefined && fc.multi_conf === false) ??
    null
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

/** The featured entry a catalog id refers to; null when the id isn't a
 *  featured one, or the board doesn't carry it. */
export function featuredEntryForId<T extends { id: string; component_id: string }>(
  id: string,
  board: { id: string; featured_components?: ReadonlyArray<T> } | null
): T | null {
  if (!board || !isFeaturedId(id)) return null;
  return (
    (board.featured_components ?? []).find(
      (c) => buildFeaturedId(board.id, c.id) === id
    ) ?? null
  );
}

/** Resolve a featured catalog id to the component it actually adds; non-featured or unknown ids pass through. */
export function resolveFeaturedComponentId(
  id: string,
  board: FeaturedIdBoard | null
): string {
  return featuredEntryForId(id, board)?.component_id ?? id;
}
