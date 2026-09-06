/**
 * Session cache of interface providers: one shared fetch per interface,
 * subscribers notified on resolve, a failure warned once and left uncached.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ESPHomeAPI } from "../../src/api/index.js";
import type { ComponentCatalogEntry } from "../../src/api/types/components.js";
import {
  _clearProvidesCache,
  fetchInterfaceProviders,
  getCachedInterfaceProviders,
  subscribeInterfaceProviders,
} from "../../src/util/provides-cache.js";

function api(getComponents: ReturnType<typeof vi.fn>): ESPHomeAPI {
  return { getComponents } as unknown as ESPHomeAPI;
}

function response(ids: string[]) {
  return {
    components: ids.map((id) => ({ id }) as ComponentCatalogEntry),
    categories: [],
    total: ids.length,
    offset: 0,
    limit: 200,
  };
}

describe("interface providers cache", () => {
  beforeEach(() => _clearProvidesCache());
  afterEach(() => {
    vi.restoreAllMocks();
    _clearProvidesCache();
  });

  it("fetches once per interface and notifies subscribers", async () => {
    const getComponents = vi.fn().mockResolvedValue(response(["sensor.adc"]));
    const onChange = vi.fn();
    subscribeInterfaceProviders(onChange);
    expect(getCachedInterfaceProviders("voltage_sampler")).toBeUndefined();

    const [a, b] = await Promise.all([
      fetchInterfaceProviders(api(getComponents), "voltage_sampler"),
      fetchInterfaceProviders(api(getComponents), "voltage_sampler"),
    ]);
    expect(getComponents).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(getCachedInterfaceProviders("voltage_sampler")).toBe(a);
    expect(a).toEqual([{ domain: "sensor", stem: "adc" }]);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("warns once on a failed fetch and leaves it uncached", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const getComponents = vi.fn().mockRejectedValue(new Error("ws down"));
    const first = fetchInterfaceProviders(api(getComponents), "uart");
    const second = fetchInterfaceProviders(api(getComponents), "uart");
    await expect(first).rejects.toThrow("ws down");
    await expect(second).rejects.toThrow("ws down");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(getCachedInterfaceProviders("uart")).toBeUndefined();
    await expect(fetchInterfaceProviders(api(getComponents), "uart")).rejects.toThrow();
    expect(getComponents).toHaveBeenCalledTimes(2);
  });
});
