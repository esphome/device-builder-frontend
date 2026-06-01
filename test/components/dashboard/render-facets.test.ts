/**
 * @vitest-environment happy-dom
 *
 * Pins the responsive switch in renderFacets: mobile collapses the
 * facet pills into a single <esphome-filters-menu>; desktop renders
 * the inline pill row plus a trailing "Clear filters" button that
 * appears only when something is filtered and calls _clearAllFilters.
 */
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { renderFacets } from "../../../src/components/dashboard/render-facets.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";

// Minimal host-shaped fake. Empty _devices means the Area/Platform/
// Status facets compute no options and self-suppress, so the inline
// row reduces to the always-present labels pill — enough to assert the
// wrapper choice and the clear button without standing up the page.
function makeHost(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _devices: [],
    _localize: (k: string) => k,
    _yamlMode: false,
    _selectedLabels: [],
    _selectedAreas: [],
    _selectedPlatforms: [],
    _selectedStates: [],
    _collapseFilters: false,
    _activeFacetCount: 0,
    _hasActiveFilters: false,
    _clearAllFilters: vi.fn(),
    _computeLabelUsage: () => ({}),
    _openConfirm: vi.fn(),
    ...overrides,
  } as unknown as ESPHomePageDashboard;
}

function renderInto(host: ESPHomePageDashboard): HTMLElement {
  const container = document.createElement("div");
  render(renderFacets(host), container);
  return container;
}

describe("renderFacets responsive layout", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("collapses to the Filters menu on a narrow toolbar", () => {
    const host = makeHost({ _collapseFilters: true, _activeFacetCount: 2 });
    const container = renderInto(host);
    expect(container.querySelector("esphome-filters-menu")).not.toBeNull();
    // The inline desktop clear button is not used in the collapsed layout.
    expect(container.querySelector(".filter-clear")).toBeNull();
  });

  // _localize is stubbed to echo its key, so the count-label attribute
  // reveals which singular/plural key was chosen.
  it("uses the singular count label for exactly one active facet", () => {
    const host = makeHost({ _collapseFilters: true, _activeFacetCount: 1 });
    const menu = renderInto(host).querySelector("esphome-filters-menu");
    expect(menu?.getAttribute("count-label")).toBe(
      "dashboard.filter_menu_active_singular"
    );
  });

  it("uses the plural count label for multiple active facets", () => {
    const host = makeHost({ _collapseFilters: true, _activeFacetCount: 3 });
    const menu = renderInto(host).querySelector("esphome-filters-menu");
    expect(menu?.getAttribute("count-label")).toBe("dashboard.filter_menu_active_plural");
  });

  it("renders inline pills with no clear button when nothing is filtered", () => {
    const host = makeHost({ _collapseFilters: false, _hasActiveFilters: false });
    const container = renderInto(host);
    expect(container.querySelector("esphome-filters-menu")).toBeNull();
    expect(container.querySelector(".filter-group")).not.toBeNull();
    expect(container.querySelector(".filter-clear")).toBeNull();
  });

  it("shows the clear button on desktop when filters are active", () => {
    const host = makeHost({ _collapseFilters: false, _hasActiveFilters: true });
    const container = renderInto(host);
    const clearBtn = container.querySelector<HTMLButtonElement>(".filter-clear");
    expect(clearBtn).not.toBeNull();

    clearBtn!.click();
    expect(host._clearAllFilters).toHaveBeenCalledTimes(1);
  });
});
