import {
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFns,
  tableFeatures,
} from "@tanstack/lit-table";

/**
 * The TanStack Table v9 feature set for the device table. v9 tree-shakes
 * per-feature APIs, so every feature the table's types touch must be
 * registered here — the search box needs global filtering (whose row
 * model lives in the column-filtering feature), the column defs set
 * ``size`` (column sizing), and the header/pagination controls need
 * sorting, visibility, and pagination. ``sortFns`` registers the
 * built-in sorting functions so the ``auto`` sort of string columns
 * keeps v8's alphanumeric behavior.
 */
export const deviceTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns,
});

export type DeviceTableFeatures = typeof deviceTableFeatures;
