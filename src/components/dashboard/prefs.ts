import type { ColumnVisibilityState, SortingState } from "@tanstack/lit-table";
import { DashboardView, SortDirection } from "../../api/types/system.js";
import type { DashboardPrefs, DashboardPrefsChange } from "../../context/index.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";
import { pickDashboardPrefs } from "../app-shell/data-load.js";

const VIEW_STORAGE_KEY = "esphome-dashboard-view";

/** This browser's last dashboard view, or ``null`` when unknown or unreadable. */
export function readCachedView(): DashboardView | null {
  try {
    const view = localStorage.getItem(VIEW_STORAGE_KEY);
    return view === DashboardView.CARDS || view === DashboardView.TABLE ? view : null;
  } catch {
    return null;
  }
}

/** Remember *view* so the next load paints it before preferences arrive. */
export function cacheView(view: DashboardView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Storage blocked (private mode, quota); the server preference still applies.
  }
}

/** Apply the shell's dashboard prefs once per mount, so a reconnect can't undo a toggle. */
export function seedDashboardPreferences(host: ESPHomePageDashboard): void {
  if (!host._dashboardPrefs || host._prefsSeeded) return;
  host._prefsSeeded = true;
  applyDashboardPreferences(host, host._dashboardPrefs);
}

/** Copy the view and table preferences onto the dashboard host. */
export function applyDashboardPreferences(
  host: ESPHomePageDashboard,
  prefs: DashboardPrefs
): void {
  host._view = prefs.dashboard_view;
  cacheView(prefs.dashboard_view);
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
}

/**
 * Persist *patch* and hand it to app-shell, which seeds the next mount from it.
 *
 * app-shell keeps the patch on top of any snapshot until the write settles,
 * then takes the server's values: the write's reply, or a refetch when the
 * write fails (nothing new if that fails too).
 */
export async function saveDashboardPrefs(
  host: ESPHomePageDashboard,
  patch: Partial<DashboardPrefs>
): Promise<void> {
  publishDashboardPrefs(host, { prefs: patch, phase: "start" });
  let settled: Partial<DashboardPrefs> = {};
  try {
    settled = pickDashboardPrefs(await host._api.updatePreferences(patch));
  } catch (err) {
    const current = await host._api.getPreferences().catch(() => null);
    if (current) settled = pickDashboardPrefs(current);
    throw err;
  } finally {
    publishDashboardPrefs(host, { prefs: settled, phase: "settle" });
  }
}

/** Persist a table preference and mirror it onto the host state that seeds a remounted table. */
export function saveTablePreference(host: ESPHomePageDashboard, e: CustomEvent): void {
  const type = e.type;
  let patch: Partial<DashboardPrefs>;
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
    const visibility = (e as CustomEvent<ColumnVisibilityState>).detail;
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
  saveDashboardPrefs(host, patch).catch((err) => {
    console.warn("Failed to save table preferences", err);
  });
}

function publishDashboardPrefs(
  host: ESPHomePageDashboard,
  detail: DashboardPrefsChange
): void {
  host.dispatchEvent(
    new CustomEvent("dashboard-prefs-changed", { detail, bubbles: true, composed: true })
  );
}
