/**
 * @vitest-environment happy-dom
 *
 * Pins that the dashboard paints the user's view from first paint: the cached
 * view picks the skeleton, and preferences seed it in the same update devices load.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The loaded dashboard mounts dialog children that crash under happy-dom.
import "./_mock-dashboard-children.js";

import { flushMicrotasks } from "../_dom.js";
import { DashboardView, type UserPreferences } from "../../src/api/types/system.js";
import { ESPHomePageDashboard } from "../../src/pages/dashboard.js";

const prefs = (view: DashboardView) =>
  ({
    dashboard_view: view,
    table_page_size: 25,
    table_column_visibility: {},
    table_sort_column: null,
    table_sort_direction: null,
  }) as unknown as UserPreferences;

describe("dashboard view from preferences", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("paints the saved table view on the first update, never cards", async () => {
    const page = new ESPHomePageDashboard();
    const getPreferences = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = page as any;
    p._api = { getPreferences, updatePreferences: vi.fn(async () => {}) };
    document.body.appendChild(page);
    await page.updateComplete;

    const seen: string[] = [];
    new MutationObserver(() => seen.push(page.getAttribute("view") ?? "")).observe(page, {
      attributes: true,
      attributeFilter: ["view"],
    });
    // app-shell sets both in one INITIAL_STATE handler.
    p._preferences = prefs(DashboardView.TABLE);
    p._devicesLoaded = true;
    await page.updateComplete;
    await flushMicrotasks(8);

    expect(p._view).toBe(DashboardView.TABLE);
    expect(seen).toEqual(["table"]);
    expect(getPreferences).not.toHaveBeenCalled();
  });

  it("does not let a later snapshot override a view chosen this mount", async () => {
    const page = new ESPHomePageDashboard();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = page as any;
    p._api = { updatePreferences: vi.fn(async () => {}) };
    p._preferences = prefs(DashboardView.TABLE);
    document.body.appendChild(page);
    await page.updateComplete;

    p._enterDeviceView(DashboardView.CARDS);
    p._preferences = prefs(DashboardView.TABLE);
    await page.updateComplete;

    expect(p._view).toBe(DashboardView.CARDS);
    expect(page.getAttribute("view")).toBe("cards");
  });

  it("paints the cached view's skeleton before preferences arrive", async () => {
    localStorage.setItem("esphome-dashboard-view", "table");
    const page = new ESPHomePageDashboard();
    document.body.appendChild(page);
    await page.updateComplete;

    expect(page.getAttribute("view")).toBe("table");
    expect(page.shadowRoot?.querySelector(".skeleton-table")).not.toBeNull();
    expect(page.shadowRoot?.querySelector(".skeleton-card")).toBeNull();
  });

  it("caches the view chosen in the toolbar", async () => {
    const page = new ESPHomePageDashboard();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = page as any;
    p._api = { updatePreferences: vi.fn(async () => {}) };
    document.body.appendChild(page);
    await page.updateComplete;

    p._enterDeviceView(DashboardView.TABLE);
    expect(localStorage.getItem("esphome-dashboard-view")).toBe("table");
  });
});
