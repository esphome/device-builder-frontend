/**
 * @vitest-environment happy-dom
 *
 * Pins the three clear paths on ESPHomePageDashboard: ``_clearSearch``
 * empties the search term and resyncs YAML mode, ``_clearFacets`` drops the
 * facet selections and keeps the search, and ``_clearAllFilters`` (the
 * no-results escape hatch) does both (esphome/device-builder#1160).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomePageDashboard } from "../../src/pages/dashboard.js";

describe("_clearSearch", () => {
  it("clears the search term, resyncs YAML, and leaves facets intact", () => {
    const page = new ESPHomePageDashboard();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.assign(page as any, {
      _search: "kitchen",
      _selectedAreas: ["living"],
    });
    const sync = vi.spyOn(page, "_syncYamlSearch").mockImplementation(() => {});

    page._clearSearch();

    expect(page._search).toBe("");
    expect(page._selectedAreas).toEqual(["living"]);
    expect(sync).toHaveBeenCalledOnce();
  });
});

describe("_clearFacets", () => {
  it("drops every facet selection and leaves the search term alone", () => {
    const page = new ESPHomePageDashboard();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.assign(page as any, {
      _search: "kitchen",
      _selectedLabels: ["ble"],
      _selectedAreas: ["living"],
      _selectedPlatforms: ["ESP32"],
      _selectedStates: ["online"],
      _selectedUpdateStatus: ["update_available"],
    });
    const sync = vi.spyOn(page, "_syncYamlSearch").mockImplementation(() => {});

    page._clearFacets();

    expect(page._search).toBe("kitchen");
    expect(page._selectedLabels).toEqual([]);
    expect(page._selectedAreas).toEqual([]);
    expect(page._selectedPlatforms).toEqual([]);
    expect(page._selectedStates).toEqual([]);
    expect(page._selectedUpdateStatus).toEqual([]);
    // Search untouched, so YAML mode has nothing to resync.
    expect(sync).not.toHaveBeenCalled();
  });
});

describe("_clearAllFilters", () => {
  it("clears the search term as well as the facets", () => {
    const page = new ESPHomePageDashboard();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.assign(page as any, {
      _search: "kitchen",
      _selectedAreas: ["living"],
    });
    vi.spyOn(page, "_syncYamlSearch").mockImplementation(() => {});

    page._clearAllFilters();

    expect(page._search).toBe("");
    expect(page._selectedAreas).toEqual([]);
  });
});
