import type { SortingState, VisibilityState } from "@tanstack/lit-table";
import { SortDirection } from "../../api/types/system.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";

export async function loadPreferences(host: ESPHomePageDashboard): Promise<void> {
  try {
    const prefs = await host._api.getPreferences();
    host._view = prefs.dashboard_view;
    host._tablePageSize = prefs.table_page_size;
    host._tableColumnVisibility = prefs.table_column_visibility;
    if (prefs.table_sort_column) {
      host._tableSorting = [
        {
          id: prefs.table_sort_column,
          desc: prefs.table_sort_direction === SortDirection.DESC,
        },
      ];
    } else {
      host._tableSorting = [];
    }
  } catch {
    // Preferences are not critical — fall through with defaults.
  }
}

/**
 * Persist a table preference and mirror it onto the host state that
 * seeds a remounted table, so a Card ↔ List toggle (which destroys
 * the table element) doesn't reset in-session changes (#1899).
 */
export function saveTablePreference(host: ESPHomePageDashboard, e: CustomEvent): void {
  const type = e.type;
  if (type === "table-sort-change") {
    const sorting = (e as CustomEvent<SortingState>).detail;
    const first = sorting[0] ?? null;
    host._tableSorting = sorting;
    host._api
      .updatePreferences({
        table_sort_column: first?.id ?? null,
        table_sort_direction: first
          ? first.desc
            ? SortDirection.DESC
            : SortDirection.ASC
          : null,
      })
      .catch(() => {});
  } else if (type === "table-visibility-change") {
    const visibility = (e as CustomEvent<VisibilityState>).detail;
    host._tableColumnVisibility = visibility;
    host._api.updatePreferences({ table_column_visibility: visibility }).catch(() => {});
  } else if (type === "table-page-size-change") {
    const pageSize = (e as CustomEvent<number>).detail;
    host._tablePageSize = pageSize;
    host._api.updatePreferences({ table_page_size: pageSize }).catch(() => {});
  }
}
