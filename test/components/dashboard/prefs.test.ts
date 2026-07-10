/**
 * @vitest-environment happy-dom
 *
 * saveTablePreference mirrors each change onto the host fields that
 * seed a remounted table.
 */
import type { VisibilityState } from "@tanstack/lit-table";
import { describe, expect, it, vi } from "vitest";
import { SortDirection } from "../../../src/api/types/system.js";
import { saveTablePreference } from "../../../src/components/dashboard/prefs.js";
import { makeDashboardHost } from "./_host.js";

function makeHost() {
  const updatePreferences = vi.fn(async () => {});
  const host = makeDashboardHost({
    _api: { updatePreferences },
    _tablePageSize: 25,
    _tableColumnVisibility: null,
    _tableSorting: null,
  });
  return { host, updatePreferences };
}

const event = (type: string, detail: unknown) => new CustomEvent(type, { detail });

describe("saveTablePreference", () => {
  it("mirrors a page-size change onto the host and persists it", () => {
    const { host, updatePreferences } = makeHost();
    saveTablePreference(host, event("table-page-size-change", 50));
    expect(host._tablePageSize).toBe(50);
    expect(updatePreferences).toHaveBeenCalledWith({ table_page_size: 50 });
  });

  it("mirrors a column-visibility change onto the host and persists it", () => {
    const { host, updatePreferences } = makeHost();
    const visibility: VisibilityState = { comment: true, ip: false };
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
    await Promise.resolve();
    expect(host._tablePageSize).toBe(10);
    expect(warn).toHaveBeenCalledWith("Failed to save table preferences", boom);
    warn.mockRestore();
  });
});
