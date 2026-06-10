/**
 * @vitest-environment happy-dom
 *
 * Pins renderFacets: one <esphome-filters-popover> of accordion
 * sections, per-dimension visibility rules, the Area searchable
 * threshold, the count-label wiring, and the labels section's edit /
 * create requests driving the dashboard's label-dialog state.
 */
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { renderFacets } from "../../../src/components/dashboard/render-facets.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";

// Minimal host-shaped fake. Empty _devices means the Area/Platform
// facets compute no options and self-suppress, so the popover
// reduces to the always-present labels + status sections — enough to
// assert the wrapper choice without standing up the page.
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
    _labelDialogOpen: false,
    _labelDialogEditing: null,
    ...overrides,
  } as unknown as ESPHomePageDashboard;
}

function renderInto(host: ESPHomePageDashboard): HTMLElement {
  const container = document.createElement("div");
  render(renderFacets(host), container);
  return container;
}

const sectionByName = (root: HTMLElement, name: string) =>
  [...root.querySelectorAll("esphome-filter-section")].find(
    (el) => el.getAttribute("name") === name
  );

describe("renderFacets", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("collapses every dimension into a single Filters popover", () => {
    const container = renderInto(makeHost({ _activeFacetCount: 2 }));
    expect(container.querySelector("esphome-filters-popover")).not.toBeNull();
    expect(container.querySelector("esphome-labels-filter-section")).not.toBeNull();
    // No legacy wrapper / inline pill row.
    expect(container.querySelector("esphome-filters-menu")).toBeNull();
    expect(container.querySelector("esphome-facet-filter")).toBeNull();
  });

  // The count-label is a single ICU plural key fed the active count; the
  // grammatical form is IntlMessageFormat's job. The badge tracks facet
  // selections only — a lone search term isn't counted here (#1160).
  it.each([1, 3])("passes the active facet count (%i) to the count label", (count) => {
    const calls: Array<[string, Record<string, unknown> | undefined]> = [];
    const localize = (key: string, args?: Record<string, unknown>): string => {
      calls.push([key, args]);
      return key;
    };
    const popover = renderInto(
      makeHost({ _activeFacetCount: count, _localize: localize })
    ).querySelector("esphome-filters-popover");
    expect(popover?.getAttribute("count-label")).toBe("dashboard.filter_menu_active");
    expect(calls).toContainEqual(["dashboard.filter_menu_active", { count }]);
  });

  // _localize echoes its key, so sections are identifiable by their
  // name attribute. Empty _devices means the fleet is current.
  const updatesSection = (root: HTMLElement) =>
    sectionByName(root, "dashboard.filter_update_status");

  it("renders the Updates section when a device needs an update", () => {
    const host = makeHost({ _devices: [{ update_available: true }] });
    expect(updatesSection(renderInto(host))).not.toBeUndefined();
  });

  it("suppresses the Updates section when the fleet is current", () => {
    const host = makeHost({ _devices: [] });
    expect(updatesSection(renderInto(host))).toBeUndefined();
  });

  it("keeps the Updates section when a filter is selected but the fleet is current", () => {
    const host = makeHost({ _devices: [], _selectedUpdateStatus: ["update_available"] });
    expect(updatesSection(renderInto(host))).not.toBeUndefined();
  });

  it("suppresses the Updates section in YAML-search mode", () => {
    const host = makeHost({
      _devices: [{ has_pending_changes: true }],
      _yamlMode: true,
    });
    expect(updatesSection(renderInto(host))).toBeUndefined();
  });

  it("suppresses the labels section in YAML-search mode", () => {
    const container = renderInto(makeHost({ _yamlMode: true }));
    expect(container.querySelector("esphome-labels-filter-section")).toBeNull();
  });

  const areaDevices = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ area: `Area ${i}` }));

  it("keeps the Area section plain at 8 or fewer options", () => {
    const container = renderInto(makeHost({ _devices: areaDevices(8) }));
    const area = sectionByName(container, "dashboard.filter_area");
    expect(area?.hasAttribute("searchable")).toBe(false);
  });

  it("makes the Area section searchable past 8 options", () => {
    const container = renderInto(makeHost({ _devices: areaDevices(9) }));
    const area = sectionByName(container, "dashboard.filter_area");
    expect(area?.hasAttribute("searchable")).toBe(true);
  });

  it("opens the label dialog in edit mode on request-edit-label", () => {
    const host = makeHost();
    const container = renderInto(host);
    const labels = container.querySelector("esphome-labels-filter-section")!;
    const label = { id: "l1", name: "kitchen", color: null };
    labels.dispatchEvent(
      new CustomEvent("request-edit-label", {
        detail: label,
        bubbles: true,
        composed: true,
      })
    );
    expect(host._labelDialogEditing).toBe(label);
    expect(host._labelDialogOpen).toBe(true);
  });

  it("opens the label dialog in create mode on request-create-label", () => {
    const host = makeHost({ _labelDialogEditing: { id: "stale" } });
    const container = renderInto(host);
    const labels = container.querySelector("esphome-labels-filter-section")!;
    labels.dispatchEvent(
      new CustomEvent("request-create-label", { bubbles: true, composed: true })
    );
    expect(host._labelDialogEditing).toBeNull();
    expect(host._labelDialogOpen).toBe(true);
  });
});
