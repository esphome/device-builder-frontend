/**
 * @vitest-environment happy-dom
 *
 * Pins the dashboard's view from first paint and across remounts: the URL or
 * cached view picks the skeleton, preferences seed it once per mount, and
 * app-shell owns the writes remounts seed from.
 */
import { ContextProvider } from "@lit/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The loaded dashboard mounts dialog children that crash under happy-dom.
import "./_mock-dashboard-children.js";

import { flush, flushMicrotasks, identityLocalize } from "../_dom.js";
import { DashboardView, type UserPreferences } from "../../src/api/types/system.js";
import type { ESPHomeApp } from "../../src/components/app-shell.js";
import { onSetDashboardPrefs } from "../../src/components/app-shell/settings-actions.js";
import { type DashboardPrefs, dashboardPrefsContext } from "../../src/context/index.js";
import { ESPHomePageDashboard } from "../../src/pages/dashboard.js";

const prefs = (
  view: DashboardView,
  over: Partial<DashboardPrefs> = {}
): DashboardPrefs => ({
  dashboard_view: view,
  table_page_size: 25,
  table_column_visibility: {},
  table_sort_column: null,
  table_sort_direction: null,
  ...over,
});

/** Stands in for app-shell: provides the context and runs the real write handler. */
class Shell {
  readonly el = document.createElement("div");
  readonly provider = new ContextProvider(this.el, {
    context: dashboardPrefsContext,
    initialValue: null,
  });
  server = prefs(DashboardView.CARDS);
  _prefsWritesInFlight = 0;
  _localize = identityLocalize as ESPHomeApp["_localize"];
  _api = {
    updatePreferences: vi.fn(async (patch: Partial<DashboardPrefs>) => {
      this.server = { ...this.server, ...patch };
      return this.server as unknown as UserPreferences;
    }),
  };

  constructor() {
    this.el.addEventListener("set-dashboard-prefs", (e) =>
      onSetDashboardPrefs(this as unknown as ESPHomeApp, e as CustomEvent)
    );
    document.body.appendChild(this.el);
  }

  get _dashboardPrefs(): DashboardPrefs | null {
    return this.provider.value;
  }

  set _dashboardPrefs(v: DashboardPrefs | null) {
    this.provider.setValue(v);
  }

  /** Make the next write wait; returns a function that lets it finish. */
  holdNextWrite(outcome: "ok" | "fail" = "ok"): () => void {
    let release!: () => void;
    const settle = this._api.updatePreferences.getMockImplementation()!;
    this._api.updatePreferences.mockImplementationOnce(
      (patch) =>
        new Promise((resolve, reject) => {
          release = () =>
            outcome === "ok" ? resolve(settle(patch)) : reject(new Error("offline"));
        })
    );
    return () => release();
  }

  async mount() {
    const page = new ESPHomePageDashboard();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = page as any;
    p._api = {};
    this.el.appendChild(page);
    await page.updateComplete;
    return p;
  }
}

describe("dashboard view from preferences", () => {
  let shell: Shell;

  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    shell = new Shell();
  });

  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("paints the saved table view on the first update, never cards", async () => {
    const page = await shell.mount();
    const seen: string[] = [];
    new MutationObserver(() => seen.push(page.getAttribute("view") ?? "")).observe(page, {
      attributes: true,
      attributeFilter: ["view"],
    });
    // app-shell sets both in one INITIAL_STATE handler.
    shell._dashboardPrefs = prefs(DashboardView.TABLE);
    page._devicesLoaded = true;
    await page.updateComplete;
    await flushMicrotasks(8);

    expect(page._view).toBe(DashboardView.TABLE);
    expect(seen).toEqual(["table"]);
  });

  it("does not let a later snapshot override a view chosen this mount", async () => {
    shell._dashboardPrefs = prefs(DashboardView.TABLE);
    const page = await shell.mount();
    page._enterDeviceView(DashboardView.CARDS);
    await flush();
    shell._dashboardPrefs = prefs(DashboardView.TABLE);
    await page.updateComplete;

    expect(page._view).toBe(DashboardView.CARDS);
    expect(page.getAttribute("view")).toBe("cards");
  });

  it("paints the cached view's skeleton before preferences arrive", async () => {
    localStorage.setItem("esphome-dashboard-view", "table");
    const page = await shell.mount();

    expect(page.getAttribute("view")).toBe("table");
    expect(page.shadowRoot?.querySelector(".skeleton-table")).not.toBeNull();
    expect(page.shadowRoot?.querySelector(".skeleton-card")).toBeNull();
  });

  it("caches the view chosen in the toolbar", async () => {
    const page = await shell.mount();
    page._enterDeviceView(DashboardView.TABLE);
    expect(localStorage.getItem("esphome-dashboard-view")).toBe("table");
  });

  it("opens a ?view=table deep link, or browser-back to one, in table with cards saved", async () => {
    window.history.replaceState({}, "", "/?view=table");
    const page = await shell.mount();
    shell._dashboardPrefs = prefs(DashboardView.CARDS, { table_page_size: 50 });
    await page.updateComplete;

    expect(page._view).toBe(DashboardView.TABLE);
    expect(page._tablePageSize).toBe(50);
    expect(localStorage.getItem("esphome-dashboard-view")).toBeNull();
  });

  describe("across a remount", () => {
    beforeEach(() => {
      shell._dashboardPrefs = prefs(DashboardView.CARDS);
    });

    it("keeps a view toggled before leaving the dashboard", async () => {
      const first = await shell.mount();
      first._enterDeviceView(DashboardView.TABLE);
      first.remove();

      // Return via a bare "/" (not browser-back, which keeps ?view=).
      window.history.replaceState({}, "", "/");
      const second = await shell.mount();
      expect(second._view).toBe(DashboardView.TABLE);
      expect(localStorage.getItem("esphome-dashboard-view")).toBe("table");
    });

    it("keeps table settings changed before leaving the dashboard", async () => {
      const first = await shell.mount();
      first._saveTablePreference(
        new CustomEvent("table-page-size-change", { detail: 50 })
      );
      first._saveTablePreference(
        new CustomEvent("table-sort-change", { detail: [{ id: "name", desc: true }] })
      );
      first.remove();

      // Return via a bare "/" (not browser-back, which keeps ?view=).
      window.history.replaceState({}, "", "/");
      const second = await shell.mount();
      expect(second._tablePageSize).toBe(50);
      expect(second._tableSorting).toEqual([{ id: "name", desc: true }]);
    });

    it("finishes a write whose dashboard was removed before the reply", async () => {
      const first = await shell.mount();
      const release = shell.holdNextWrite();
      first._enterDeviceView(DashboardView.TABLE);
      first.remove();
      release();
      await flush();

      expect(shell._prefsWritesInFlight).toBe(0);
      expect(shell._dashboardPrefs?.dashboard_view).toBe(DashboardView.TABLE);
      // Return via a bare "/" (not browser-back, which keeps ?view=).
      window.history.replaceState({}, "", "/");
      const second = await shell.mount();
      expect(second._view).toBe(DashboardView.TABLE);
    });

    it("drops a failed view change before the next mount", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const first = await shell.mount();
      const release = shell.holdNextWrite("fail");
      first._enterDeviceView(DashboardView.TABLE);
      release();
      await flush();
      expect(first._view).toBe(DashboardView.TABLE);
      expect(shell._dashboardPrefs?.dashboard_view).toBe(DashboardView.CARDS);
      expect(warn).toHaveBeenCalled();
      first.remove();

      // Return via a bare "/" (not browser-back, which keeps ?view=).
      window.history.replaceState({}, "", "/");
      const second = await shell.mount();
      expect(second._view).toBe(DashboardView.CARDS);
    });
  });

  it("keeps a view picked before the first snapshot when its write fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const page = await shell.mount();
    const release = shell.holdNextWrite("fail");
    page._enterDeviceView(DashboardView.TABLE);
    release();
    await flush();
    // The first snapshot still carries the old view.
    shell._dashboardPrefs = prefs(DashboardView.CARDS);
    await page.updateComplete;

    expect(page._view).toBe(DashboardView.TABLE);
    expect(localStorage.getItem("esphome-dashboard-view")).toBe("table");
  });
});
