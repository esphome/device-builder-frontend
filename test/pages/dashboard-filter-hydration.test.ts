/**
 * @vitest-environment happy-dom
 *
 * Pins the session-seed half of ESPHomePageDashboard._hydrateFromUrl: facets
 * the URL doesn't carry are restored from the session store, but a facet the
 * URL sets wins over the session seed (discussion #3717).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomePageDashboard } from "../../src/pages/dashboard.js";
import {
  loadDashboardFilters,
  saveDashboardFilters,
} from "../../src/util/dashboard-filters-session.js";

const FULL = {
  labels: ["lbl-1"],
  areas: ["Kitchen"],
  platforms: ["esp32"],
  states: ["online"],
  updates: ["update_available"],
};

function makePage(): ESPHomePageDashboard {
  const page = new ESPHomePageDashboard();
  // _syncYamlSearch touches the YAML search controller; the hydrate path
  // doesn't need it, so stub it like the other dashboard unit tests do.
  vi.spyOn(page, "_syncYamlSearch").mockImplementation(() => {});
  return page;
}

const hydrate = (page: ESPHomePageDashboard) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (page as any)._hydrateFromUrl();

describe("dashboard filter session seeding", () => {
  beforeEach(() => {
    sessionStorage.clear();
    history.replaceState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("seeds every facet from the session store when the URL carries none", () => {
    saveDashboardFilters(FULL);
    const page = makePage();
    hydrate(page);
    expect(page._selectedLabels).toEqual(["lbl-1"]);
    expect(page._selectedAreas).toEqual(["Kitchen"]);
    expect(page._selectedPlatforms).toEqual(["esp32"]);
    expect(page._selectedStates).toEqual(["online"]);
    expect(page._selectedUpdateStatus).toEqual(["update_available"]);
  });

  it("lets the URL win per-field while still seeding the rest from session", () => {
    saveDashboardFilters(FULL);
    history.replaceState(null, "", "/?platforms=esp8266");
    const page = makePage();
    hydrate(page);
    // URL wins for platforms; the other facets still come from the session.
    expect(page._selectedPlatforms).toEqual(["esp8266"]);
    expect(page._selectedAreas).toEqual(["Kitchen"]);
    expect(page._selectedStates).toEqual(["online"]);
  });

  it("drops unknown update buckets from the session seed", () => {
    saveDashboardFilters({ ...FULL, updates: ["bogus", "update_available"] });
    const page = makePage();
    hydrate(page);
    expect(page._selectedUpdateStatus).toEqual(["update_available"]);
  });

  it("preserves saved label ids while URL label names are still resolving", () => {
    // URL labels arrive as names that resolve to ids once the catalog loads;
    // until then _selectedLabels is [], and persisting that must not wipe the
    // previously saved label selection from the session store.
    saveDashboardFilters({
      labels: ["lbl-1"],
      areas: [],
      platforms: [],
      states: [],
      updates: [],
    });
    const page = makePage();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const internals = page as any;
    internals._pendingLabelNames = ["Office"];
    internals._selectedLabels = [];
    internals._selectedPlatforms = ["esp32"];
    internals._persistFilterState(new Map([["_selectedPlatforms", undefined]]));
    const saved = loadDashboardFilters();
    expect(saved?.labels).toEqual(["lbl-1"]); // preserved, not clobbered to []
    expect(saved?.platforms).toEqual(["esp32"]); // other facets still saved
  });

  it("leaves facets at their empty defaults with no URL and no session", () => {
    const page = makePage();
    hydrate(page);
    expect(page._selectedPlatforms).toEqual([]);
    expect(page._selectedStates).toEqual([]);
    expect(page._selectedLabels).toEqual([]);
    expect(page._selectedAreas).toEqual([]);
    expect(page._selectedUpdateStatus).toEqual([]);
  });
});
