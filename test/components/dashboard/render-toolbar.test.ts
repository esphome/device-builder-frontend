/**
 * @vitest-environment happy-dom
 *
 * Pins renderSearchInput's clear (×) control: hidden on an empty (or
 * whitespace-only) query, shown when a query is typed, and wired to the
 * host's _clearSearch handler (issue #1160). The handler's own behavior
 * is covered in dashboard-clear-search.test.ts.
 */
import { render } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { renderSearchInput } from "../../../src/components/dashboard/render-toolbar.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";

function makeHost(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _localize: (k: string) => k,
    _yamlMode: false,
    _search: "",
    _syncYamlSearch: vi.fn(),
    _onSearchKeyDown: vi.fn(),
    _clearSearch: vi.fn(),
    ...overrides,
  } as unknown as ESPHomePageDashboard;
}

function renderInto(host: ESPHomePageDashboard): HTMLElement {
  const container = document.createElement("div");
  render(renderSearchInput(host), container);
  return container;
}

describe("renderSearchInput", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("hides the clear button when the query is empty", () => {
    const container = renderInto(makeHost({ _search: "" }));
    expect(container.querySelector(".search-clear")).toBeNull();
  });

  it("hides the clear button for a whitespace-only query", () => {
    const container = renderInto(makeHost({ _search: "   " }));
    expect(container.querySelector(".search-clear")).toBeNull();
  });

  it("shows the clear button when a query is present", () => {
    const container = renderInto(makeHost({ _search: "kitchen" }));
    expect(container.querySelector(".search-clear")).not.toBeNull();
  });

  it("wires the clear button to the host's _clearSearch handler", () => {
    const clearSearch = vi.fn();
    const host = makeHost({ _search: "kitchen", _clearSearch: clearSearch });
    renderInto(host).querySelector<HTMLButtonElement>(".search-clear")?.click();
    expect(clearSearch).toHaveBeenCalledOnce();
  });
});
