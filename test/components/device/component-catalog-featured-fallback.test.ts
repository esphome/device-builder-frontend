/**
 * @vitest-environment happy-dom
 *
 * The "Recommended" category must never strand the view on an empty grid:
 * when a featured fetch settles with nothing addable (every recommendation is
 * already configured, or a search matches no recommendation), the catalog falls
 * back to "all" instead of rendering "0 of N / No components found". A search
 * that DOES match a recommendation stays on Featured and shows it, rather than
 * discarding the match by switching to All (device-builder-frontend#1040).
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

  // The scenario reported in #1040: a search whose term matches no
  // recommendation must not strand the grid on "No components found".
  it("falls back to all when a search matches no recommendation", async () => {
    const { el, getComponents } = await mountFeatured({ search: "zzz", components: [] });
    expect(el._category).toBe("all");
    expect(getComponents).toHaveBeenCalled();
  });

  it("stays on featured when a search matches a recommendation", async () => {
    const { el, getComponents } = await mountFeatured({
      search: "ethernet",
      components: [ETHERNET_CARD],
    });
    expect(el._category).toBe("featured");
    expect(getComponents).not.toHaveBeenCalled();
  });
});

describe("component-catalog _onSearchInput keeps the category", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const typeSearch = (el: ESPHomeComponentCatalog, value: string) => {
    const input = { value } as HTMLInputElement;
    (el as unknown as { _onSearchInput: (ev: Event) => void })._onSearchInput({
      target: input,
    } as unknown as Event);
  };

  it("stays on Featured when a search term is typed", async () => {
    const { el } = await mountFeatured();
    expect(el._category).toBe("featured");
    typeSearch(el, "relay");
    // No eager switch: the search is server-scoped to the recommendations, and
    // the updated() fallback drops to All only once an empty featured fetch
    // settles.
    expect(el._category).toBe("featured");
  });

  it("leaves Featured intact when the search is only whitespace", async () => {
    const { el } = await mountFeatured();
    typeSearch(el, "   ");
    expect(el._category).toBe("featured");
  });
});
