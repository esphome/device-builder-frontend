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
  renderViewToggle,
} from "../../../src/components/dashboard/render-toolbar.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";
import { identityLocalize, renderInto } from "../../_dom.js";

function makeHost(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _localize: identityLocalize,
    _yamlMode: false,
    _search: "",
    _syncYamlSearch: vi.fn(),
    _onSearchKeyDown: vi.fn(),
    _clearSearch: vi.fn(),
    ...overrides,
  } as unknown as ESPHomePageDashboard;
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
