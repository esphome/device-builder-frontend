import { afterEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { ComponentCatalogEntry } from "../../src/api/types.js";
import {
  _clearComponentCache,
  fetchComponent,
  getCachedComponent,
  subscribeComponentCache,
} from "../../src/util/component-name-cache.js";

const entry = (id: string, name: string): ComponentCatalogEntry =>
  ({
    id,
    name,
    description: "",
    category: "core" as ComponentCatalogEntry["category"],
    docs_url: "",
    image_url: "",
    dependencies: [],
    multi_conf: false,
    supported_platforms: [],
    config_entries: [],
  }) as ComponentCatalogEntry;

interface MockApi {
  api: ESPHomeAPI;
  getComponentBodies: ReturnType<typeof vi.fn>;
}

/** Mock that mirrors the batched WS shape: `getComponentBodies(ids,
 *  platform, boardId)` resolves a map of id → entry. `impl` returns
 *  the entry for one id (or `null` for a miss); the mock plumbs that
 *  across the requested ids and accepts an optional override promise
 *  so tests can pin in-flight behaviour. */
const mockApi = (
  impl: (id: string, platform?: string, boardId?: string) => ComponentCatalogEntry | null,
  overridePromise?: () => Promise<Record<string, ComponentCatalogEntry>>
): MockApi => {
  const getComponentBodies = vi.fn(
    (ids: string[], platform?: string, boardId?: string) => {
      if (overridePromise) return overridePromise();
      const result: Record<string, ComponentCatalogEntry> = {};
      for (const id of ids) {
        const e = impl(id, platform, boardId);
        if (e !== null) result[id] = e;
      }
      return Promise.resolve(result);
    }
  );
  return { api: { getComponentBodies } as unknown as ESPHomeAPI, getComponentBodies };
};

describe("component-name-cache", () => {
  afterEach(() => {
    _clearComponentCache();
  });

  it("fetches uncached components and caches the result", async () => {
    const { api, getComponentBodies } = mockApi(() => entry("wifi", "WiFi"));

    expect(getCachedComponent("wifi")).toBeUndefined();
    const got = await fetchComponent(api, "wifi");

    expect(got?.name).toBe("WiFi");
    expect(getComponentBodies).toHaveBeenCalledTimes(1);
    expect(getCachedComponent("wifi")?.name).toBe("WiFi");

    // Second call hits the cache, no extra backend round-trip.
    await fetchComponent(api, "wifi");
    expect(getComponentBodies).toHaveBeenCalledTimes(1);
  });

  it("coalesces parallel fetches into one batched call", async () => {
    const { api, getComponentBodies } = mockApi((id) => entry(id, `name:${id}`));

    const [a, b, c] = await Promise.all([
      fetchComponent(api, "wifi"),
      fetchComponent(api, "api"),
      fetchComponent(api, "logger"),
    ]);

    expect(a?.name).toBe("name:wifi");
    expect(b?.name).toBe("name:api");
    expect(c?.name).toBe("name:logger");
    expect(getComponentBodies).toHaveBeenCalledTimes(1);
    expect(getComponentBodies).toHaveBeenCalledWith(
      ["wifi", "api", "logger"],
      undefined,
      undefined
    );
  });

  it("dedupes concurrent in-flight calls for the same key", async () => {
    let resolve!: (v: Record<string, ComponentCatalogEntry>) => void;
    const { api, getComponentBodies } = mockApi(
      () => null,
      () => new Promise<Record<string, ComponentCatalogEntry>>((r) => (resolve = r))
    );

    const a = fetchComponent(api, "binary_sensor.gpio", "esp32");
    const b = fetchComponent(api, "binary_sensor.gpio", "esp32");
    const c = fetchComponent(api, "binary_sensor.gpio", "esp32");

    // Give the microtask queue a chance to flush the batch.
    await Promise.resolve();
    expect(getComponentBodies).toHaveBeenCalledTimes(1);

    resolve({ "binary_sensor.gpio": entry("binary_sensor.gpio", "GPIO Binary Sensor") });

    await expect(a).resolves.toMatchObject({ name: "GPIO Binary Sensor" });
    await expect(b).resolves.toMatchObject({ name: "GPIO Binary Sensor" });
    await expect(c).resolves.toMatchObject({ name: "GPIO Binary Sensor" });
    expect(getComponentBodies).toHaveBeenCalledTimes(1);
  });

  it("rejects pending bucket waiters when the cache is cleared mid-flight", async () => {
    // Tests that call _clearComponentCache while a fetch is still
    // pending would otherwise hang on the dangling promise; the
    // cleanup path must settle every waiter explicitly.
    const { api } = mockApi(
      () => null,
      () => new Promise<Record<string, ComponentCatalogEntry>>(() => {})
    );

    const pending = fetchComponent(api, "wifi");
    _clearComponentCache();

    await expect(pending).rejects.toThrow("component-name-cache cleared");
  });

  it("does not resolve prototype keys as cache hits", async () => {
    // Reachable from yaml-completion when the user types a key
    // whose name shadows an Object.prototype member (`toString`,
    // `constructor`, etc.). A bare `entries[id]` lookup would
    // resolve to the inherited function and cache it forever.
    const { api } = mockApi(() => null);

    const result = await fetchComponent(api, "toString");
    expect(result).toBeNull();
    expect(getCachedComponent("toString")).toBeNull();
  });

  it("dedupes a same-id fetch that arrives after the batch has flushed", async () => {
    // After the microtask flush, a same-id call must join the
    // pending in-flight promise instead of triggering a second
    // batch. Closes the "between flush and response" race window.
    let resolve!: (v: Record<string, ComponentCatalogEntry>) => void;
    const { api, getComponentBodies } = mockApi(
      () => null,
      () => new Promise<Record<string, ComponentCatalogEntry>>((r) => (resolve = r))
    );

    const a = fetchComponent(api, "wifi");
    // Drain the microtask queue so the batch has flushed (api call started).
    await Promise.resolve();
    expect(getComponentBodies).toHaveBeenCalledTimes(1);

    const b = fetchComponent(api, "wifi");
    resolve({ wifi: entry("wifi", "WiFi") });

    await expect(a).resolves.toMatchObject({ name: "WiFi" });
    await expect(b).resolves.toMatchObject({ name: "WiFi" });
    expect(getComponentBodies).toHaveBeenCalledTimes(1);
  });

  it("batches per (platform, boardId) context", async () => {
    const { api, getComponentBodies } = mockApi((id, platform) =>
      entry(id, `${id}|${platform ?? ""}`)
    );

    await Promise.all([
      fetchComponent(api, "sensor.dht", "esp32"),
      fetchComponent(api, "sensor.dht", "esp8266"),
      fetchComponent(api, "sensor.dht"),
    ]);

    expect(getComponentBodies).toHaveBeenCalledTimes(3);
    expect(getCachedComponent("sensor.dht", "esp32")?.name).toBe("sensor.dht|esp32");
    expect(getCachedComponent("sensor.dht", "esp8266")?.name).toBe("sensor.dht|esp8266");
    expect(getCachedComponent("sensor.dht")?.name).toBe("sensor.dht|");
  });

  it("caches null (catalog miss) so unknown ids aren't re-fetched", async () => {
    const { api, getComponentBodies } = mockApi(() => null);

    const first = await fetchComponent(api, "nonsense.id");
    expect(first).toBeNull();
    expect(getCachedComponent("nonsense.id")).toBeNull();

    await fetchComponent(api, "nonsense.id");
    expect(getComponentBodies).toHaveBeenCalledTimes(1);
  });

  it("does not cache transport errors (allows retry)", async () => {
    let attempts = 0;
    const { api } = mockApi(
      () => entry("wifi", "WiFi"),
      () => {
        attempts++;
        if (attempts === 1) return Promise.reject(new Error("network down"));
        return Promise.resolve({ wifi: entry("wifi", "WiFi") });
      }
    );

    await expect(fetchComponent(api, "wifi")).rejects.toThrow("network down");
    expect(getCachedComponent("wifi")).toBeUndefined();

    const second = await fetchComponent(api, "wifi");
    expect(second?.name).toBe("WiFi");
  });

  it("isolates listener exceptions from the fetch promise and other listeners", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const goodA = vi.fn();
    const goodB = vi.fn();
    const bad = vi.fn(() => {
      throw new Error("subscriber blew up");
    });
    subscribeComponentCache(goodA);
    subscribeComponentCache(bad);
    subscribeComponentCache(goodB);

    const { api } = mockApi(() => entry("wifi", "WiFi"));
    const result = await fetchComponent(api, "wifi");

    expect(result?.name).toBe("WiFi");
    expect(goodA).toHaveBeenCalledTimes(1);
    expect(goodB).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("notifies subscribers once per flushed batch", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeComponentCache(listener);

    const { api } = mockApi((id) => entry(id, id));
    await Promise.all([fetchComponent(api, "api"), fetchComponent(api, "wifi")]);

    // One batched flush → one notify, not one per id.
    expect(listener).toHaveBeenCalledTimes(1);

    // Cached read shouldn't notify again.
    await fetchComponent(api, "api");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    const { api: api2 } = mockApi(() => entry("logger", "Logger"));
    await fetchComponent(api2, "logger");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
