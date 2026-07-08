import type { SortingState, VisibilityState } from "@tanstack/lit-table";
import type { UserPreferences } from "../../api/types/system.js";
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

/** Persist a table preference and mirror it onto the host state that seeds a remounted table. */
export function saveTablePreference(host: ESPHomePageDashboard, e: CustomEvent): void {
  const type = e.type;
  let patch: Partial<UserPreferences>;
  if (type === "table-sort-change") {
    const sorting = (e as CustomEvent<SortingState>).detail;
    const first = sorting[0] ?? null;
    host._tableSorting = sorting;
    patch = {
      table_sort_column: first?.id ?? null,
      table_sort_direction: first
        ? first.desc
          ? SortDirection.DESC
          : SortDirection.ASC
        : null,
    };
  } else if (type === "table-visibility-change") {
    const visibility = (e as CustomEvent<VisibilityState>).detail;
    host._tableColumnVisibility = visibility;
    patch = { table_column_visibility: visibility };
  } else if (type === "table-page-size-change") {
    const pageSize = (e as CustomEvent<number>).detail;
    host._tablePageSize = pageSize;
    patch = { table_page_size: pageSize };
  } else {
    return;
  }
  // The mirror is kept on failure — cosmetic prefs, self-healing on
  // the next mount — but a failing write shouldn't be invisible.
  host._api.updatePreferences(patch).catch((err) => {
    console.warn("Failed to save table preferences", err);
  });
}
