import type { CellContext, ColumnDef, Row, Table } from "@tanstack/lit-table";
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
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
} from "@tanstack/lit-table";
import type { DeviceRow } from "./device-row.js";

/**
 * The TanStack Table v9 feature set for the device table. v9 tree-shakes
 * per-feature APIs, so every feature the table's types touch must be
 * registered here — the search box needs global filtering (whose row
 * model lives in the column-filtering feature), the column defs set
 * ``size`` (column sizing), and the header/pagination controls need
 * sorting, visibility, and pagination. The ``sortFns`` registry lists
 * only the comparators ``auto`` resolves for this table's string
 * columns (keeping v8's alphanumeric behavior without shipping the
 * full built-in set); ``datetime`` and ``basic`` are deliberately
 * unregistered — a registry miss falls back to ``basic`` silently in
 * production builds, so a future Date-valued column must add
 * ``sortFn_datetime`` here.
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
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

export type DeviceTableFeatures = typeof deviceTableFeatures;

// Composed aliases so consumers don't restate the
// ``<DeviceTableFeatures, DeviceRow>`` pairing at every site.
export type DeviceTable = Table<DeviceTableFeatures, DeviceRow>;
export type DeviceTableRow = Row<DeviceTableFeatures, DeviceRow>;
export type DeviceColumnDef = ColumnDef<DeviceTableFeatures, DeviceRow>;
export type DeviceCellContext = CellContext<DeviceTableFeatures, DeviceRow, unknown>;
