/**
 * @vitest-environment happy-dom
 *
 * Pins ESPHomePageDashboard._clearSearch: it empties the search term and
 * resyncs YAML mode, leaving facet selections untouched (issue #1160).
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
