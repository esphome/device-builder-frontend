/**
 * @vitest-environment happy-dom
 *
 * Pins renderFacets: one <esphome-filters-popover> of accordion
 * sections, per-dimension visibility rules, the Area searchable
 * threshold, the count-label wiring, and the labels section's edit /
 * create requests driving the dashboard's label-dialog state.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { renderInto } from "../../_dom.js";
import { renderFacets } from "../../../src/components/dashboard/render-facets.js";
import { makeDashboardHost } from "./_host.js";

// Minimal host-shaped fake. Empty _devices means the Area/Platform
// facets compute no options and self-suppress, so the popover
// reduces to the always-present labels + status sections — enough to
// assert the wrapper choice without standing up the page.
function makeHost(overrides: Partial<Record<string, unknown>> = {}) {
  return makeDashboardHost({
    _devices: [],
    _selectedLabels: [],
    _selectedAreas: [],
    _selectedPlatforms: [],
    _selectedStates: [],
    _selectedUpdateStatus: [],
    _activeFacetCount: 0,
    _hasActiveFilters: false,
    _clearFacets: vi.fn(),
    _clearAllFilters: vi.fn(),
    _computeLabelUsage: () => ({}),
    _openConfirm: vi.fn(),
    _labelDialogOpen: false,
    _labelDialogEditing: null,
    ...overrides,
  });
}

const sectionByName = (root: HTMLElement, name: string) =>
  [...root.querySelectorAll("esphome-filter-section")].find(
    (el) => el.getAttribute("name") === name
  );

describe("renderFacets", () => {
  it("collapses every dimension into a single Filters popover", () => {
    const container = renderInto(renderFacets(makeHost({ _activeFacetCount: 2 })));
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
      renderFacets(makeHost({ _activeFacetCount: count, _localize: localize }))
    ).querySelector("esphome-filters-popover");
    expect(popover?.getAttribute("count-label")).toBe("dashboard.filter_menu_active");
    expect(calls).toContainEqual(["dashboard.filter_menu_active", { count }]);
  });

  // The popover's "Clear filters" clears facets only. It sits beside the
  // search box, and its badge never counted the search term, so wiping the
  // search from here would clear something the menu never showed
  // (esphome/device-builder#1160, the issue the bare #1160 in the comments
  // around here points at).
  it("clears facets only, leaving the search term to the search box's own x", () => {
    const host = makeHost({ _activeFacetCount: 2 });
    const popover = renderInto(renderFacets(host)).querySelector(
      "esphome-filters-popover"
    )!;

    popover.dispatchEvent(new CustomEvent("clear-filters"));

    expect(host._clearFacets).toHaveBeenCalledOnce();
    expect(host._clearAllFilters).not.toHaveBeenCalled();
  });

  // _localize echoes its key, so sections are identifiable by their
  // name attribute. Empty _devices means the fleet is current.
  const updatesSection = (root: HTMLElement) =>
    sectionByName(root, "dashboard.filter_update_status");

  it("renders the Updates section when a device needs an update", () => {
    const host = makeHost({
      _devices: [
        {
          update_available: true,
          api_enabled: true,
          runtime_state: { state: "online", active_source: "mdns" },
        },
      ],
    });
    expect(updatesSection(renderInto(renderFacets(host)))).not.toBeUndefined();
  });

  it("suppresses the Updates section when the fleet is current", () => {
    const host = makeHost({ _devices: [] });
    expect(updatesSection(renderInto(renderFacets(host)))).toBeUndefined();
  });

  it("keeps the Updates section when a filter is selected but the fleet is current", () => {
    const host = makeHost({ _devices: [], _selectedUpdateStatus: ["update_available"] });
    expect(updatesSection(renderInto(renderFacets(host)))).not.toBeUndefined();
  });

  it("suppresses the Updates section in YAML-search mode", () => {
    const host = makeHost({
      _devices: [
        {
          has_pending_changes: true,
          runtime_state: { state: "online", active_source: "mdns" },
        },
      ],
      _yamlMode: true,
    });
    expect(updatesSection(renderInto(renderFacets(host)))).toBeUndefined();
  });

  it("suppresses the labels section in YAML-search mode", () => {
    const container = renderInto(renderFacets(makeHost({ _yamlMode: true })));
    expect(container.querySelector("esphome-labels-filter-section")).toBeNull();
  });

  const areaDevices = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      area: `Area ${i}`,
      runtime_state: { state: "unknown" },
    }));

  it("keeps the Area section plain at 8 or fewer options", () => {
    const container = renderInto(renderFacets(makeHost({ _devices: areaDevices(8) })));
    const area = sectionByName(container, "dashboard.filter_area");
    expect(area?.hasAttribute("searchable")).toBe(false);
  });

  it("makes the Area section searchable past 8 options", () => {
    const container = renderInto(renderFacets(makeHost({ _devices: areaDevices(9) })));
    const area = sectionByName(container, "dashboard.filter_area");
    expect(area?.hasAttribute("searchable")).toBe(true);
  });

  it("opens the label dialog in edit mode on request-edit-label", () => {
    const host = makeHost();
    const container = renderInto(renderFacets(host));
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
    const container = renderInto(renderFacets(host));
    const labels = container.querySelector("esphome-labels-filter-section")!;
    labels.dispatchEvent(
      new CustomEvent("request-create-label", { bubbles: true, composed: true })
    );
    expect(host._labelDialogEditing).toBeNull();
    expect(host._labelDialogOpen).toBe(true);
  });
});
