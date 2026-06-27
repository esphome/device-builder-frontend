import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadDashboardFilters,
  saveDashboardFilters,
  STORAGE_KEY,
} from "../../src/util/dashboard-filters-session.js";

describe("dashboard-filters-session", () => {
  // The vitest config runs in the ``node`` environment which has no
  // ``sessionStorage``; a tiny in-memory Map stand-in covers the three
  // methods the helper uses.
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when nothing is stored", () => {
    expect(loadDashboardFilters()).toBeNull();
  });

  it("round-trips the facet selection", () => {
    saveDashboardFilters({
      labels: ["lbl-1", "lbl-2"],
      areas: ["Kitchen"],
      platforms: ["esp32"],
      states: ["online"],
      updates: ["update_available"],
    });
    expect(loadDashboardFilters()).toEqual({
      labels: ["lbl-1", "lbl-2"],
      areas: ["Kitchen"],
      platforms: ["esp32"],
      states: ["online"],
      updates: ["update_available"],
    });
  });

  it("returns null for unparseable JSON", () => {
    store.set(STORAGE_KEY, "{not json");
    expect(loadDashboardFilters()).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    store.set(STORAGE_KEY, JSON.stringify(["nope"]));
    expect(loadDashboardFilters()).toBeNull();
  });

  it("falls back to empty arrays for missing or malformed facets", () => {
    // A legacy / partial payload must not throw or leak non-string entries
    // into a facet — each bad facet degrades to an empty selection.
    store.set(
      STORAGE_KEY,
      JSON.stringify({ platforms: ["esp32"], states: "online", labels: [1, 2] })
    );
    expect(loadDashboardFilters()).toEqual({
      labels: [],
      areas: [],
      platforms: ["esp32"],
      states: [],
      updates: [],
    });
  });

  it("does not throw when storage is unavailable", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    expect(() =>
      saveDashboardFilters({
        labels: [],
        areas: [],
        platforms: ["esp32"],
        states: [],
        updates: [],
      })
    ).not.toThrow();
    expect(loadDashboardFilters()).toBeNull();
  });
});
