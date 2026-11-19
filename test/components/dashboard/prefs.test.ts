/**
 * @vitest-environment happy-dom
 *
 * Unit tests for the dashboard prefs helpers: the cached view, applying a
 * preferences slice, and handing writes to app-shell.
 */
import type { ColumnVisibilityState } from "@tanstack/lit-table";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardView, SortDirection } from "../../../src/api/types/system.js";
import {
  applyDashboardPreferences,
  cacheView,
  readCachedView,
  saveDashboardPrefs,
  saveTablePreference,
} from "../../../src/components/dashboard/prefs.js";
import type { DashboardPrefs } from "../../../src/context/index.js";
import { makeDashboardHost } from "./_host.js";

function makeHost() {
  const dispatchEvent = vi.fn();
  const host = makeDashboardHost({
    dispatchEvent,
    _view: DashboardView.CARDS,
    _tablePageSize: 25,
    _tableColumnVisibility: null,
    _tableSorting: null,
  });
  return { host, dispatchEvent };
}

/** The patch the last ``set-dashboard-prefs`` event carried. */
function sentPatch(dispatchEvent: ReturnType<typeof vi.fn>) {
  const e = dispatchEvent.mock.calls[
    dispatchEvent.mock.calls.length - 1
  ][0] as CustomEvent;
  expect(e.type).toBe("set-dashboard-prefs");
  return e.detail as Partial<DashboardPrefs>;
}

const event = (type: string, detail: unknown) => new CustomEvent(type, { detail });

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("cached dashboard view", () => {
  it("round-trips a view", () => {
    cacheView(DashboardView.TABLE);
    expect(readCachedView()).toBe(DashboardView.TABLE);
  });

  it("returns null for a missing or unknown value", () => {
    expect(readCachedView()).toBeNull();
    localStorage.setItem("esphome-dashboard-view", "grid");
    expect(readCachedView()).toBeNull();
  });

  it("degrades to null / no-op when storage throws", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });
    expect(() => cacheView(DashboardView.TABLE)).not.toThrow();
    expect(readCachedView()).toBeNull();
  });
});

describe("applyDashboardPreferences", () => {
  const prefs = (over: Partial<DashboardPrefs> = {}) =>
    ({
      dashboard_view: DashboardView.TABLE,
      table_page_size: 50,
      table_column_visibility: { ip: false },
      table_sort_column: "name",
      table_sort_direction: SortDirection.DESC,
      ...over,
    }) as DashboardPrefs;

  it("copies the view and table preferences onto the host and caches the view", () => {
    const { host } = makeHost();
    applyDashboardPreferences(host, prefs());
    expect(host._view).toBe(DashboardView.TABLE);
    expect(readCachedView()).toBe(DashboardView.TABLE);
    expect(host._tablePageSize).toBe(50);
    expect(host._tableColumnVisibility).toEqual({ ip: false });
    expect(host._tableSorting).toEqual([{ id: "name", desc: true }]);
  });

  it("leaves the view and cache alone when told to skip it", () => {
    const { host } = makeHost();
    applyDashboardPreferences(host, prefs(), { skipView: true });
    expect(host._view).toBe(DashboardView.CARDS);
    expect(readCachedView()).toBeNull();
    expect(host._tablePageSize).toBe(50);
  });

  it("maps an unset sort column to an empty sort", () => {
    const { host } = makeHost();
    applyDashboardPreferences(host, prefs({ table_sort_column: null }));
    expect(host._tableSorting).toEqual([]);
  });
});

describe("saveDashboardPrefs", () => {
  it("hands the patch to app-shell in a bubbling, composed event", () => {
    const { host, dispatchEvent } = makeHost();
    saveDashboardPrefs(host, { dashboard_view: DashboardView.TABLE });
    const e = dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect(e.bubbles && e.composed).toBe(true);
    expect(sentPatch(dispatchEvent)).toEqual({ dashboard_view: DashboardView.TABLE });
  });
});

describe("saveTablePreference", () => {
  it("mirrors a page-size change onto the host and saves it", () => {
    const { host, dispatchEvent } = makeHost();
    saveTablePreference(host, event("table-page-size-change", 50));
    expect(host._tablePageSize).toBe(50);
    expect(sentPatch(dispatchEvent)).toEqual({ table_page_size: 50 });
  });

  it("mirrors a column-visibility change onto the host and saves it", () => {
    const { host, dispatchEvent } = makeHost();
    const visibility: ColumnVisibilityState = { comment: true, ip: false };
    saveTablePreference(host, event("table-visibility-change", visibility));
    expect(host._tableColumnVisibility).toBe(visibility);
    expect(sentPatch(dispatchEvent)).toEqual({ table_column_visibility: visibility });
  });

  it("mirrors a sort change onto the host and saves it", () => {
    const { host, dispatchEvent } = makeHost();
    const sorting = [{ id: "name", desc: true }];
    saveTablePreference(host, event("table-sort-change", sorting));
    expect(host._tableSorting).toBe(sorting);
    expect(sentPatch(dispatchEvent)).toEqual({
      table_sort_column: "name",
      table_sort_direction: SortDirection.DESC,
    });
  });

  it("mirrors a cleared sort as an empty list and null columns", () => {
    const { host, dispatchEvent } = makeHost();
    saveTablePreference(host, event("table-sort-change", []));
    expect(host._tableSorting).toEqual([]);
    expect(sentPatch(dispatchEvent)).toEqual({
      table_sort_column: null,
      table_sort_direction: null,
    });
  });
});
