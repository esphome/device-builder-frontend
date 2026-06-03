import { afterEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import {
  _resetPinRegistryModesCache,
  fetchPinRegistryModes,
  getCachedPinRegistryModes,
  subscribePinRegistryModes,
} from "../../src/util/pin-registry-modes-cache.js";

const makeApi = (impl: () => Promise<Record<string, string[]>>): ESPHomeAPI =>
  ({ getPinRegistryModes: vi.fn(impl) }) as unknown as ESPHomeAPI;

afterEach(() => {
  _resetPinRegistryModesCache();
});

describe("pin-registry-modes-cache", () => {
  it("fetches once and memoizes; concurrent callers share the promise", async () => {
    const api = makeApi(async () => ({ pca9554: ["input", "output"] }));

    const [a, b] = await Promise.all([
      fetchPinRegistryModes(api),
      fetchPinRegistryModes(api),
    ]);

    expect(a).toEqual({ pca9554: ["input", "output"] });
    expect(b).toBe(a);
    await fetchPinRegistryModes(api);
    expect(api.getPinRegistryModes).toHaveBeenCalledTimes(1);
    expect(getCachedPinRegistryModes()).toEqual({ pca9554: ["input", "output"] });
  });

  it("notifies subscribers when the map populates", async () => {
    const cb = vi.fn();
    subscribePinRegistryModes(cb);

    await fetchPinRegistryModes(makeApi(async () => ({})));

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("caches an empty map on fetch failure so it doesn't retry-storm", async () => {
    const api = makeApi(async () => {
      throw new Error("ws down");
    });

    expect(await fetchPinRegistryModes(api)).toEqual({});
    await fetchPinRegistryModes(api);
    expect(api.getPinRegistryModes).toHaveBeenCalledTimes(1);
  });
});
