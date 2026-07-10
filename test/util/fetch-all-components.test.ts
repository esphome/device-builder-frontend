/**
 * ``fetchAllComponents`` drains every page of a ``getComponents`` query by
 * following ``resp.total``, so fetch-all callers never truncate at a
 * hardcoded limit (#1152).
 */
import { describe, expect, it, vi } from "vitest";

import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import type { ComponentCatalogEntry } from "../../src/api/types/components.js";
import {
  COMPONENT_FETCH_PAGE,
  fetchAllComponents,
} from "../../src/util/fetch-all-components.js";
import { makeComponentEntry } from "./_make-component-entry.js";

const entries = (count: number, prefix = "sensor.c"): ComponentCatalogEntry[] =>
  Array.from({ length: count }, (_, i) => makeComponentEntry(`${prefix}${i}`));

function pagedApi(all: ComponentCatalogEntry[]) {
  const getComponents = vi.fn(async (args: { offset?: number; limit?: number }) => ({
    components: all.slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 50)),
    categories: [],
    total: all.length,
    offset: args.offset ?? 0,
    limit: args.limit ?? 50,
  }));
  return { getComponents, api: { getComponents } as unknown as ESPHomeAPI };
}

describe("fetchAllComponents", () => {
  it("returns a small set in one call", async () => {
    const all = entries(3);
    const { getComponents, api } = pagedApi(all);
    expect(await fetchAllComponents(api, { provides: "sensor" })).toEqual(all);
    expect(getComponents).toHaveBeenCalledTimes(1);
    expect(getComponents.mock.calls[0][0]).toEqual({
      provides: "sensor",
      offset: 0,
      limit: COMPONENT_FETCH_PAGE,
    });
  });

  it("pages until total is reached, forwarding the query on every call", async () => {
    const all = entries(COMPONENT_FETCH_PAGE * 2 + 7);
    const { getComponents, api } = pagedApi(all);
    const result = await fetchAllComponents(api, {
      provides: "sensor",
      platform: "esp32",
      board_id: "esp32-evb",
    });
    expect(result).toEqual(all);
    expect(getComponents).toHaveBeenCalledTimes(3);
    expect(getComponents.mock.calls.map((c) => c[0])).toEqual(
      [0, 1, 2].map((page) => ({
        provides: "sensor",
        platform: "esp32",
        board_id: "esp32-evb",
        offset: page * COMPONENT_FETCH_PAGE,
        limit: COMPONENT_FETCH_PAGE,
      }))
    );
  });

  it("returns an exact page-multiple without an extra empty fetch", async () => {
    const all = entries(COMPONENT_FETCH_PAGE);
    const { getComponents, api } = pagedApi(all);
    expect(await fetchAllComponents(api)).toEqual(all);
    expect(getComponents).toHaveBeenCalledTimes(1);
  });

  it("stops on a short page even when total overreports", async () => {
    const page = entries(2);
    const getComponents = vi.fn().mockResolvedValue({
      components: page,
      categories: [],
      total: 9999,
      offset: 0,
      limit: COMPONENT_FETCH_PAGE,
    });
    const api = { getComponents } as unknown as ESPHomeAPI;
    expect(await fetchAllComponents(api)).toEqual(page);
    expect(getComponents).toHaveBeenCalledTimes(1);
  });
});
