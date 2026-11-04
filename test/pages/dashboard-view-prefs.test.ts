/**
 * @vitest-environment happy-dom
 *
 * Pins that the dashboard paints the user's view from first paint: the cached
 * view picks the skeleton, preferences seed it in the same update devices load,
 * and a remount seeds from what was last saved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The loaded dashboard mounts dialog children that crash under happy-dom.
import "./_mock-dashboard-children.js";

import { flushMicrotasks } from "../_dom.js";
import { DashboardView, type UserPreferences } from "../../src/api/types/system.js";
import type { ESPHomeApp } from "../../src/components/app-shell.js";
import { onDashboardPrefsChanged } from "../../src/components/app-shell/data-load.js";
import type { DashboardPrefs } from "../../src/context/index.js";
import { ESPHomePageDashboard } from "../../src/pages/dashboard.js";

const prefs = (view: DashboardView) =>
  ({
    dashboard_view: view,
    table_page_size: 25,
    table_column_visibility: {},
    table_sort_column: null,
    table_sort_direction: null,
  }) as DashboardPrefs;

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
    p._dashboardPrefs = prefs(DashboardView.TABLE);
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
    p._dashboardPrefs = prefs(DashboardView.TABLE);
    document.body.appendChild(page);
    await page.updateComplete;

    p._enterDeviceView(DashboardView.CARDS);
    p._dashboardPrefs = prefs(DashboardView.TABLE);
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

  describe("across a remount", () => {
    // Stands in for app-shell: owns the context value and merges dashboard writes.
    const shell = { _dashboardPrefs: null as DashboardPrefs | null };
    // Stands in for the backend's stored preferences.
    let server: DashboardPrefs;
    const save = async (patch: Partial<DashboardPrefs>) => {
      server = { ...server, ...patch };
      return server as unknown as UserPreferences;
    };
    const onChanged = (e: Event) =>
      onDashboardPrefsChanged(
        shell as unknown as ESPHomeApp,
        e as CustomEvent<Partial<DashboardPrefs>>
      );

    beforeEach(() => {
      shell._dashboardPrefs = prefs(DashboardView.CARDS);
      server = prefs(DashboardView.CARDS);
      document.addEventListener("dashboard-prefs-changed", onChanged);
    });

    afterEach(() => {
      document.removeEventListener("dashboard-prefs-changed", onChanged);
    });

    async function mount() {
      const page = new ESPHomePageDashboard();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = page as any;
      p._api = {
        updatePreferences: vi.fn(save),
        getPreferences: vi.fn(async () => server),
      };
      p._dashboardPrefs = shell._dashboardPrefs;
      document.body.appendChild(page);
      await page.updateComplete;
      return p;
    }

    it("keeps a view toggled before leaving the dashboard", async () => {
      const first = await mount();
      first._enterDeviceView(DashboardView.TABLE);
      first.remove();

      const second = await mount();
      expect(second._view).toBe(DashboardView.TABLE);
      expect(localStorage.getItem("esphome-dashboard-view")).toBe("table");
    });

    it("keeps table settings changed before leaving the dashboard", async () => {
      const first = await mount();
      first._saveTablePreference(
        new CustomEvent("table-page-size-change", { detail: 50 })
      );
      first._saveTablePreference(
        new CustomEvent("table-sort-change", { detail: [{ id: "name", desc: true }] })
      );
      first.remove();

      const second = await mount();
      expect(second._tablePageSize).toBe(50);
      expect(second._tableSorting).toEqual([{ id: "name", desc: true }]);
    });

    it("keeps a view saved while a reconnect snapshot was in flight", async () => {
      const first = await mount();
      let settle!: () => void;
      first._api.updatePreferences = vi.fn(
        (patch: Partial<DashboardPrefs>) =>
          new Promise((resolve) => {
            settle = () => resolve(save(patch));
          })
      );
      first._enterDeviceView(DashboardView.TABLE);
      // The reconnect snapshot predates the write and lands before its reply.
      shell._dashboardPrefs = prefs(DashboardView.CARDS);
      settle();
      await flushMicrotasks(8);
      first.remove();

      const second = await mount();
      expect(second._view).toBe(DashboardView.TABLE);
    });

    it("drops a failed view change before the next mount", async () => {
      const first = await mount();
      first._api.updatePreferences = vi.fn(async () => {
        throw new Error("offline");
      });
      first._enterDeviceView(DashboardView.TABLE);
      await flushMicrotasks(8);
      expect(first._view).toBe(DashboardView.TABLE);
      first.remove();

      const second = await mount();
      expect(second._view).toBe(DashboardView.CARDS);
    });
  });
});
