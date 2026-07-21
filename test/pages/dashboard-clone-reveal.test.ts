/**
 * @vitest-environment happy-dom
 *
 * Pins ESPHomePageDashboard._onCloned: clears the search (which matched the
 * source device and would hide the clone), leaves facets intact, and arms the
 * adopt-style highlight + deferred scroll for the fresh clone (issue
 * device-builder#2246).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomePageDashboard } from "../../src/pages/dashboard.js";

describe("_onCloned", () => {
  afterEach(() => vi.useRealTimers());

  it("clears the search, keeps facets, and arms the highlight for the clone", () => {
    vi.useFakeTimers();
    const page = new ESPHomePageDashboard();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Object.assign(page as any, {
      _search: "kitchen",
      _selectedAreas: ["living"],
      _devices: [],
    });
    const sync = vi.spyOn(page, "_syncYamlSearch").mockImplementation(() => {});

    page._onCloned("bedroom-bulb.yaml");

    expect(page._search).toBe("");
    expect(sync).toHaveBeenCalledOnce();
    expect(page._selectedAreas).toEqual(["living"]);
    expect(page._recentlyAdopted).toBe("bedroom-bulb.yaml");
    // The clone isn't in _devices yet, so the scroll stays armed for the
    // ADDED push that updated() consumes.
    expect(page._pendingAdoptScroll).toBe("bedroom-bulb.yaml");

    vi.advanceTimersByTime(4000);
    expect(page._recentlyAdopted).toBeNull();
  });
});
