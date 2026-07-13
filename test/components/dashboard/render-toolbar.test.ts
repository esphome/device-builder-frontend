/**
 * @vitest-environment happy-dom
 *
 * Pins renderSearchInput's clear (×) control: hidden on an empty (or
 * whitespace-only) query, shown when a query is typed, and wired to the
 * host's _clearSearch handler (issue #1160). The handler's own behavior
 * is covered in dashboard-clear-search.test.ts.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { DashboardView } from "../../../src/api/types/system.js";
import {
  renderSearchInput,
  renderSelectBarOrFab,
  renderViewToggle,
  renderYamlToolbar,
} from "../../../src/components/dashboard/render-toolbar.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";
import { renderInto } from "../../_dom.js";
import { makeDashboardHost } from "./_host.js";

function makeHost(overrides: Partial<Record<string, unknown>> = {}) {
  return makeDashboardHost({
    _syncYamlSearch: vi.fn(),
    _onSearchKeyDown: vi.fn(),
    _clearSearch: vi.fn(),
    ...overrides,
  });
}

describe("renderSearchInput", () => {
  it("hides the clear button when the query is empty", () => {
    const container = renderInto(renderSearchInput(makeHost({ _search: "" })));
    expect(container.querySelector(".search-clear")).toBeNull();
  });

  it("hides the clear button for a whitespace-only query", () => {
    const container = renderInto(renderSearchInput(makeHost({ _search: "   " })));
    expect(container.querySelector(".search-clear")).toBeNull();
  });

  it("shows the clear button when a query is present", () => {
    const container = renderInto(renderSearchInput(makeHost({ _search: "kitchen" })));
    expect(container.querySelector(".search-clear")).not.toBeNull();
  });

  it("wires the clear button to the host's _clearSearch handler", () => {
    const clearSearch = vi.fn();
    const host = makeHost({ _search: "kitchen", _clearSearch: clearSearch });
    renderInto(renderSearchInput(host))
      .querySelector<HTMLButtonElement>(".search-clear")
      ?.click();
    expect(clearSearch).toHaveBeenCalledOnce();
  });
});

describe("renderViewToggle Expert Mode gating", () => {
  function makeToggleHost(expertMode: boolean): ESPHomePageDashboard {
    return makeHost({
      _view: DashboardView.CARDS,
      _expertMode: expertMode,
      _enterDeviceView: vi.fn(),
      _setSearchMode: vi.fn(),
    });
  }

  function renderToggle(host: ESPHomePageDashboard): HTMLElement {
    const container = renderInto(renderViewToggle(host));
    return container;
  }

  it("hides the YAML-search view button when Expert Mode is off", () => {
    const container = renderToggle(makeToggleHost(false));
    // Cards + Table only; no YAML (code-braces) button.
    expect(container.querySelectorAll(".view-toggle-btn").length).toBe(2);
    expect(container.querySelector('wa-icon[name="code-braces"]')).toBeNull();
  });

  it("shows the YAML-search view button when Expert Mode is on", () => {
    const container = renderToggle(makeToggleHost(true));
    expect(container.querySelectorAll(".view-toggle-btn").length).toBe(3);
    expect(container.querySelector('wa-icon[name="code-braces"]')).not.toBeNull();
  });
});

describe("renderYamlToolbar match count", () => {
  function makeYamlHit(shown: number, total?: number) {
    return {
      configuration: "a.yaml",
      device_name: "a",
      friendly_name: "A",
      matches: Array.from({ length: shown }, (_, i) => ({
        line_number: i + 1,
        line_text: "wifi:",
        before: [],
        after: [],
      })),
      ...(total === undefined ? {} : { total_matches: total }),
    };
  }

  function countText(hits: unknown[]): string {
    const host = makeHost({ _search: "wifi", _yamlSearch: { hits } });
    const container = renderInto(renderYamlToolbar(host as ESPHomePageDashboard));
    return container.querySelector(".device-count")?.textContent ?? "";
  }

  it("renders the 'of total' unit when the fleet total exceeds the shown sum", () => {
    const text = countText([makeYamlHit(5, 23)]);
    expect(text).toContain("5");
    expect(text).toContain("yaml_search.match_count_of");
  });

  it("renders the plain unit when total_matches is absent (older backend)", () => {
    const text = countText([makeYamlHit(5)]);
    expect(text).toContain("yaml_search.match_count");
    expect(text).not.toContain("match_count_of");
  });
});

describe("renderSelectBarOrFab bulk action wiring", () => {
  function makeSelectHost(overrides: Partial<Record<string, unknown>> = {}) {
    return makeHost({
      _selectMode: true,
      _selectedDevices: new Set(["a.yaml"]),
      _allVisibleSelected: false,
      _updateSelected: vi.fn(),
      _compileSelected: vi.fn(),
      _archiveSelected: vi.fn(),
      _deleteSelected: vi.fn(),
      _labelsSelected: vi.fn(),
      ...overrides,
    });
  }

  function dispatchFromBar(host: ESPHomePageDashboard, event: string) {
    renderInto(renderSelectBarOrFab(host))
      .querySelector("esphome-select-bar")!
      .dispatchEvent(new CustomEvent(event, { bubbles: true, composed: true }));
  }

  it("wires compile-selected to the host's _compileSelected handler", () => {
    const compileSelected = vi.fn();
    dispatchFromBar(
      makeSelectHost({ _compileSelected: compileSelected }),
      "compile-selected"
    );
    expect(compileSelected).toHaveBeenCalledOnce();
  });

  it("keeps update-selected wired to _updateSelected", () => {
    const updateSelected = vi.fn();
    dispatchFromBar(
      makeSelectHost({ _updateSelected: updateSelected }),
      "update-selected"
    );
    expect(updateSelected).toHaveBeenCalledOnce();
  });
});
