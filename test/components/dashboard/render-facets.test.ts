/**
 * @vitest-environment happy-dom
 *
 * Pins renderFacets: every facet pill collapses into a single
 * <esphome-filters-menu> (no inline pill row), the menu's count-label
 * picks the singular/plural key off the active count, and the Updates
 * pill only renders when the fleet has something to update.
 */
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { renderFacets } from "../../../src/components/dashboard/render-facets.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";

// Minimal host-shaped fake. Empty _devices means the Area/Platform/
// Status facets compute no options and self-suppress, so the menu
// reduces to the always-present labels pill — enough to assert the
// wrapper choice without standing up the page.
function makeHost(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _devices: [],
    _localize: (k: string) => k,
    _yamlMode: false,
    _selectedLabels: [],
    _selectedAreas: [],
    _selectedPlatforms: [],
    _selectedStates: [],
    _selectedUpdateStatus: [],
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

describe("renderFacets", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("collapses every facet into a single Filters menu", () => {
    const container = renderInto(makeHost({ _activeFacetCount: 2 }));
    expect(container.querySelector("esphome-filters-menu")).not.toBeNull();
    // No inline pill row / clear button — the menu owns clearing.
    expect(container.querySelector(".filter-clear")).toBeNull();
  });

  // _localize is stubbed to echo its key, so the count-label attribute
  // reveals which singular/plural key was chosen. The badge tracks facet
  // selections only — a lone search term isn't counted here (#1160).
  it("uses the singular count label for exactly one active facet", () => {
    const menu = renderInto(makeHost({ _activeFacetCount: 1 })).querySelector(
      "esphome-filters-menu"
    );
    expect(menu?.getAttribute("count-label")).toBe(
      "dashboard.filter_menu_active_singular"
    );
  });

  it("uses the plural count label for multiple active facets", () => {
    const menu = renderInto(makeHost({ _activeFacetCount: 3 })).querySelector(
      "esphome-filters-menu"
    );
    expect(menu?.getAttribute("count-label")).toBe("dashboard.filter_menu_active_plural");
  });

  // _localize echoes its key, so the Updates pill is identifiable by its
  // name attribute. Empty _devices means the fleet is current.
  const updatesPill = (root: HTMLElement) =>
    [...root.querySelectorAll("esphome-facet-filter")].find(
      (el) => el.getAttribute("name") === "dashboard.filter_update_status"
    );

  it("renders the Updates pill when a device needs an update", () => {
    const host = makeHost({ _devices: [{ update_available: true }] });
    expect(updatesPill(renderInto(host))).not.toBeUndefined();
  });

  it("suppresses the Updates pill when the fleet is current", () => {
    const host = makeHost({ _devices: [] });
    expect(updatesPill(renderInto(host))).toBeUndefined();
  });

  it("keeps the Updates pill when a filter is selected but the fleet is current", () => {
    const host = makeHost({ _devices: [], _selectedUpdateStatus: ["update_available"] });
    expect(updatesPill(renderInto(host))).not.toBeUndefined();
  });

  it("suppresses the Updates pill in YAML-search mode", () => {
    const host = makeHost({
      _devices: [{ has_pending_changes: true }],
      _yamlMode: true,
    });
    expect(updatesPill(renderInto(host))).toBeUndefined();
  });
});
