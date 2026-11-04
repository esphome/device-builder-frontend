/**
 * @vitest-environment happy-dom
 *
 * applyDashboardPreferences seeds the host from a snapshot; saveTablePreference
 * mirrors each change onto the host fields that seed a remounted table.
 */
import type { ColumnVisibilityState } from "@tanstack/lit-table";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushMicrotasks } from "../../_dom.js";
import {
  DashboardView,
  SortDirection,
  type UserPreferences,
} from "../../../src/api/types/system.js";
import {
  applyDashboardPreferences,
  cacheView,
  readCachedView,
  saveDashboardPrefs,
  saveTablePreference,
  seedDashboardPreferences,
} from "../../../src/components/dashboard/prefs.js";
import type { DashboardPrefs } from "../../../src/context/index.js";
import { makeDashboardHost } from "./_host.js";

/** Full server preferences as the API returns them, with *over* applied. */
const serverPrefs = (over: Partial<DashboardPrefs> = {}) =>
  ({
    dashboard_view: DashboardView.CARDS,
    table_page_size: 25,
    table_column_visibility: {},
    table_sort_column: null,
    table_sort_direction: null,
    theme: "system",
    ...over,
  }) as unknown as UserPreferences;

function makeHost() {
  const updatePreferences = vi.fn(async (patch: Partial<DashboardPrefs>) =>
    serverPrefs(patch)
  );
  const getPreferences = vi.fn(async () => serverPrefs());
  const host = makeDashboardHost({
    _api: { updatePreferences, getPreferences },
    dispatchEvent: vi.fn(),
    _tablePageSize: 25,
    _tableColumnVisibility: null,
    _tableSorting: null,
  });
  return { host, updatePreferences, getPreferences };
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

  it("copies the view and table preferences onto the host", () => {
    const { host } = makeHost();
    applyDashboardPreferences(host, prefs());
    expect(host._view).toBe(DashboardView.TABLE);
    expect(host._tablePageSize).toBe(50);
    expect(host._tableColumnVisibility).toEqual({ ip: false });
    expect(host._tableSorting).toEqual([{ id: "name", desc: true }]);
  });

  it("remembers the applied view for the next load", () => {
    const { host } = makeHost();
    applyDashboardPreferences(host, prefs());
    expect(readCachedView()).toBe(DashboardView.TABLE);
  });

  it("seeds from the shell's prefs once per mount", () => {
    const { host } = makeHost();
    host._prefsSeeded = false;
    host._dashboardPrefs = prefs();
    seedDashboardPreferences(host);
    host._view = DashboardView.CARDS;
    seedDashboardPreferences(host);
    expect(host._view).toBe(DashboardView.CARDS);
    expect(host._tablePageSize).toBe(50);
  });

  it("maps an unset sort column to an empty sort", () => {
    const { host } = makeHost();
    applyDashboardPreferences(host, prefs({ table_sort_column: null }));
    expect(host._tableSorting).toEqual([]);
  });
});

describe("saveDashboardPrefs", () => {
  it("hands the patch to app-shell and persists it", async () => {
    const { host, updatePreferences } = makeHost();
    await saveDashboardPrefs(host, { dashboard_view: DashboardView.TABLE });
    const event = vi.mocked(host.dispatchEvent).mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("dashboard-prefs-changed");
    expect(event.bubbles && event.composed).toBe(true);
    expect(event.detail).toEqual({ dashboard_view: DashboardView.TABLE });
    expect(updatePreferences).toHaveBeenCalledWith({
      dashboard_view: DashboardView.TABLE,
    });
  });

  const published = (host: ReturnType<typeof makeHost>["host"]) =>
    vi.mocked(host.dispatchEvent).mock.calls.map(([e]) => (e as CustomEvent).detail);
  const lastPublished = (host: ReturnType<typeof makeHost>["host"]) => {
    const details = published(host);
    return details[details.length - 1];
  };

  it("replaces app-shell's copy with the server's reply", async () => {
    const { host, updatePreferences } = makeHost();
    updatePreferences.mockResolvedValueOnce(
      serverPrefs({ dashboard_view: DashboardView.TABLE, table_page_size: 50 })
    );
    await saveDashboardPrefs(host, { dashboard_view: DashboardView.TABLE });
    expect(lastPublished(host)).toEqual({
      dashboard_view: DashboardView.TABLE,
      table_page_size: 50,
      table_column_visibility: {},
      table_sort_column: null,
      table_sort_direction: null,
    });
  });

  it("restores the server's values when the write fails", async () => {
    const { host, updatePreferences } = makeHost();
    const boom = new Error("offline");
    updatePreferences.mockRejectedValueOnce(boom);
    await expect(
      saveDashboardPrefs(host, { dashboard_view: DashboardView.TABLE })
    ).rejects.toBe(boom);
    expect(lastPublished(host)).toMatchObject({ dashboard_view: DashboardView.CARDS });
  });

  it("keeps app-shell's copy when the refetch fails too", async () => {
    const { host, updatePreferences, getPreferences } = makeHost();
    const boom = new Error("offline");
    updatePreferences.mockRejectedValueOnce(boom);
    getPreferences.mockRejectedValueOnce(new Error("offline"));
    await expect(
      saveDashboardPrefs(host, { dashboard_view: DashboardView.TABLE })
    ).rejects.toBe(boom);
    expect(published(host)).toEqual([{ dashboard_view: DashboardView.TABLE }]);
  });
});

describe("saveTablePreference", () => {
  it("mirrors a page-size change onto the host and persists it", () => {
    const { host, updatePreferences } = makeHost();
    saveTablePreference(host, event("table-page-size-change", 50));
    expect(host._tablePageSize).toBe(50);
    expect(updatePreferences).toHaveBeenCalledWith({ table_page_size: 50 });
  });

  it("mirrors a column-visibility change onto the host and persists it", () => {
    const { host, updatePreferences } = makeHost();
    const visibility: ColumnVisibilityState = { comment: true, ip: false };
    saveTablePreference(host, event("table-visibility-change", visibility));
    expect(host._tableColumnVisibility).toBe(visibility);
    expect(updatePreferences).toHaveBeenCalledWith({
      table_column_visibility: visibility,
    });
  });

  it("mirrors a sort change onto the host and persists it", () => {
    const { host, updatePreferences } = makeHost();
    const sorting = [{ id: "name", desc: true }];
    saveTablePreference(host, event("table-sort-change", sorting));
    expect(host._tableSorting).toBe(sorting);
    expect(updatePreferences).toHaveBeenCalledWith({
      table_sort_column: "name",
      table_sort_direction: SortDirection.DESC,
    });
  });

  it("mirrors a cleared sort as an empty list and null columns", () => {
    const { host, updatePreferences } = makeHost();
    saveTablePreference(host, event("table-sort-change", []));
    expect(host._tableSorting).toEqual([]);
    expect(updatePreferences).toHaveBeenCalledWith({
      table_sort_column: null,
      table_sort_direction: null,
    });
  });

  it("logs a failed persist instead of swallowing it, keeping the mirror", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { host, updatePreferences } = makeHost();
    const boom = new Error("offline");
    updatePreferences.mockRejectedValueOnce(boom);
    saveTablePreference(host, event("table-page-size-change", 10));
    await flushMicrotasks(4);
    expect(host._tablePageSize).toBe(10);
    expect(warn).toHaveBeenCalledWith("Failed to save table preferences", boom);
    warn.mockRestore();
  });
});
