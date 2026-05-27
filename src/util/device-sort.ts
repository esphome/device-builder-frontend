/**
 * Shared sort utilities for device-like objects displayed across
 * the dashboard surfaces (card grid, list view, discovery list).
 *
 * The collator options and the sort-key fallback chain
 * (``friendly_name`` → ``name`` → ``configuration``) used to live
 * in three parallel-duplicated declarations; consolidating here
 * removes the "keep them in sync" risk that produced #946.
 */

/** Locale-aware, case-insensitive, numeric-aware collator used by
 *  every device-name sort surface in the dashboard. */
export const DEVICE_SORT_COLLATOR = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});

/** Sort key for device-like objects: prefer the friendly name,
 *  fall back to the YAML hostname, then to the YAML filename.
 *  Mirrors what list/grid/discovery cells render so the sort
 *  order always matches the displayed value. */
export const deviceSortKey = (d: {
  friendly_name?: string;
  name?: string;
  configuration?: string;
}): string => d.friendly_name || d.name || d.configuration || "";
