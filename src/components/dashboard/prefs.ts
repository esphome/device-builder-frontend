import { ContextConsumer } from "@lit/context";
import type { ColumnVisibilityState, SortingState } from "@tanstack/lit-table";
import type { ReactiveController } from "lit";
import { DashboardView, SortDirection } from "../../api/types/system.js";
import { type DashboardPrefs, dashboardPrefsContext } from "../../context/index.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";
import { readDashboardUrl } from "../../util/dashboard-url.js";

const VIEW_STORAGE_KEY = "esphome-dashboard-view";

/** Restores, seeds and persists the dashboard's view and table preferences. */
export class DashboardViewPrefsController implements ReactiveController {
  private _seeded = false;
  /** A deep-linked or user-picked view, which seeding must not overwrite. */
  private _viewChosen = false;

  constructor(private readonly _host: ESPHomePageDashboard) {
    // Registered before the consumer so hostConnected restores before it seeds.
    _host.addController(this);
    new ContextConsumer(_host, {
      context: dashboardPrefsContext,
      subscribe: true,
      callback: (prefs) => this._seed(prefs),
    });
  }

  /** Paint the deep-linked view, else this browser's cached one, before preferences arrive. */
  hostConnected(): void {
    const urlView = readDashboardUrl().view;
    this._viewChosen = urlView !== undefined;
    this._host._view = urlView ?? readCachedView() ?? this._host._view;
  }

  /** Switch the device list to *view* and persist it. */
  enterView(view: DashboardView): void {
    const host = this._host;
    // YAML is a third view option: clicking cards or table exits YAML
    // search and returns to the device list.
    if (host._yamlMode) host._setSearchMode(false);
    host._view = view;
    this._viewChosen = true;
    cacheView(view);
    saveDashboardPrefs(host, { dashboard_view: view });
  }

  /** Seed once per mount, so a reconnect snapshot can't undo a toggle. */
  private _seed(prefs: DashboardPrefs | null | undefined): void {
    if (!prefs || this._seeded) return;
    this._seeded = true;
    applyDashboardPreferences(this._host, prefs, { skipView: this._viewChosen });
  }
}

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

/** Copy the view and table preferences onto the dashboard host. */
export function applyDashboardPreferences(
  host: ESPHomePageDashboard,
  prefs: DashboardPrefs,
  { skipView = false } = {}
): void {
  if (!skipView) {
    host._view = prefs.dashboard_view;
    cacheView(prefs.dashboard_view);
  }
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

/** Ask app-shell to persist *patch*; it owns the write and the copy remounts seed from. */
export function saveDashboardPrefs(
  host: ESPHomePageDashboard,
  patch: Partial<DashboardPrefs>
): void {
  host.dispatchEvent(
    new CustomEvent("set-dashboard-prefs", {
      detail: patch,
      bubbles: true,
      composed: true,
    })
  );
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
  // the next mount; app-shell logs the failing write.
  saveDashboardPrefs(host, patch);
}
