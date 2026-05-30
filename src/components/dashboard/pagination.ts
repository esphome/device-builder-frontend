/** Shared page-size sentinel + translation for the device list view. */

/** Page-size value for the "All" (no pagination) choice. */
export const ALL_PAGE_SIZE = 0;

/**
 * Resolve the page-size sentinel for TanStack. ``ALL_PAGE_SIZE`` feeds
 * the row count (a safe upper bound even with a filter active) so every
 * row lands on page 0; the floor of 1 keeps 0 (Infinite page count /
 * empty slice) from ever reaching TanStack on an empty dataset.
 */
export function effectiveTablePageSize(pageSize: number, rowCount: number): number {
  return pageSize === ALL_PAGE_SIZE ? Math.max(rowCount, 1) : pageSize;
}
