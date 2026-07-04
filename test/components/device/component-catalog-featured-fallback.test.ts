/**
 * @vitest-environment happy-dom
 *
 * "Recommended" is the no-search curated shortlist. A search moves to "all",
 * where the board's featured cards rank first (server-side), so every match is
 * visible with the recommendations on top and no term strands the grid
 * (device-builder-frontend#1040). Clearing the search returns to Recommended;
 * an explicitly pinned category opts out. Featured cards keep their styling
 * wherever they render.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/badge/badge.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type { BoardCatalogEntry } from "../../../src/api/types/boards.js";
import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import { ESPHomeComponentCatalog } from "../../../src/components/device/component-catalog.js";

const POE_BOARD = {
  id: "esp32-poe-iso",
  featured_components: [
    { id: "onboard_ethernet", component_id: "ethernet", multi_conf: false },
  ],
  featured_bundles: [],
} as unknown as BoardCatalogEntry;

const ETHERNET_CARD = {
  id: "featured.esp32-poe-iso.onboard_ethernet",
  dependencies: [],
  supported_platforms: [],
} as unknown as ComponentCatalogEntry;

async function mountFeatured({
  yaml = "",
  search = "",
  components = [ETHERNET_CARD],
}: {
  yaml?: string;
  search?: string;
  components?: ComponentCatalogEntry[];
} = {}): Promise<{
  el: ESPHomeComponentCatalog;
  getComponents: ReturnType<typeof vi.fn>;
}> {
  const el = new ESPHomeComponentCatalog();
  const getComponents = vi.fn().mockResolvedValue({
    components: [],
    categories: [],
    total: 0,
    offset: 0,
    limit: 50,
  });
  Object.assign(el as unknown as Record<string, unknown>, {
    _api: { getComponents },
    platform: "esp32",
    boardId: "esp32-poe-iso",
    board: POE_BOARD,
    yaml,
    _search: search,
    _categories: [{ id: "featured", name: "featured", count: 1 }],
    _category: "featured",
  });
  // _components / _total now read off the paged list controller, and loading is
  // controller-owned (hasLoaded replaces _initialLoad), so seed it directly.
  Object.assign((el as unknown as { _list: Record<string, unknown> })._list, {
    items: components,
    total: components.length,
    loading: false,
    hasLoaded: true,
  });
  document.body.appendChild(el);
  await el.updateComplete;
  return { el, getComponents };
}

describe("component-catalog featured-empty fallback", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("falls back to all when the only recommendation is already configured", async () => {
    const { el, getComponents } = await mountFeatured({
      yaml: "ethernet:\n  type: LAN8720\n",
    });
    expect(el._category).toBe("all");
    expect(getComponents).toHaveBeenCalled();
  });

  it("stays on featured while a recommendation is still addable", async () => {
    const { el, getComponents } = await mountFeatured();
    expect(el._category).toBe("featured");
    expect(getComponents).not.toHaveBeenCalled();
  });

  // #1040: a Recommended fetch that settles empty (all recommendations
  // configured) must not strand the grid on "No components found".
  it("falls back to all when the featured grid settles empty", async () => {
    const { el, getComponents } = await mountFeatured({ components: [] });
    expect(el._category).toBe("all");
    expect(getComponents).toHaveBeenCalled();
  });
});

describe("component-catalog search moves to All (featured leads there)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const typeSearch = (el: ESPHomeComponentCatalog, value: string) => {
    const input = { value } as HTMLInputElement;
    (el as unknown as { _onSearchInput: (ev: Event) => void })._onSearchInput({
      target: input,
    } as unknown as Event);
  };

  it("switches to All when a search term is typed", async () => {
    const { el } = await mountFeatured();
    expect(el._category).toBe("featured");
    typeSearch(el, "relay");
    // The board's featured cards rank first under "all" (server-side), so a
    // search surfaces every match with the recommendations on top and can
    // never strand the grid (#1040, device-builder#1793).
    expect(el._category).toBe("all");
  });

  it("returns to Recommended when the search is cleared", async () => {
    const { el } = await mountFeatured();
    typeSearch(el, "relay");
    expect(el._category).toBe("all");
    typeSearch(el, "");
    expect(el._category).toBe("featured");
  });

  it("leaves Featured intact when the search is only whitespace", async () => {
    const { el } = await mountFeatured();
    typeSearch(el, "   ");
    expect(el._category).toBe("featured");
  });

  it("keeps a specific category on search (only Recommended/All auto-switch)", async () => {
    const { el } = await mountFeatured();
    el._category = "sensor";
    typeSearch(el, "relay");
    expect(el._category).toBe("sensor");
  });
});

describe("component-catalog featured styling under All", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a featured.* card with featured styling under All", async () => {
    const FEATURED_CARD = {
      id: "featured.esp32-poe-iso.onboard_ethernet",
      dependencies: [],
      supported_platforms: [],
      multi_conf: true,
    } as unknown as ComponentCatalogEntry;
    const { el } = await mountFeatured({ components: [FEATURED_CARD] });
    el._category = "all";
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".component-card--featured")).not.toBeNull();
  });
});
