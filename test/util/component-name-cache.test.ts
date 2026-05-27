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

const mockApi = (
  impl: (
    id: string,
    platform?: string,
    boardId?: string
  ) => Promise<ComponentCatalogEntry | null> | ComponentCatalogEntry | null
): { api: ESPHomeAPI; getComponent: ReturnType<typeof vi.fn> } => {
  const getComponent = vi.fn((id: string, platform?: string, boardId?: string) =>
    Promise.resolve(impl(id, platform, boardId))
  );
  return { api: { getComponent } as unknown as ESPHomeAPI, getComponent };
};

describe("component-name-cache", () => {
  afterEach(() => {
    _clearComponentCache();
  });

  it("fetches uncached components and caches the result", async () => {
    const { api, getComponent } = mockApi(() => entry("wifi", "WiFi"));

    expect(getCachedComponent("wifi")).toBeUndefined();
    const got = await fetchComponent(api, "wifi");

    expect(got?.name).toBe("WiFi");
    expect(getComponent).toHaveBeenCalledTimes(1);
    expect(getCachedComponent("wifi")?.name).toBe("WiFi");

    // Second call hits the cache, no extra backend round-trip.
    await fetchComponent(api, "wifi");
    expect(getComponent).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent in-flight calls for the same key", async () => {
    let resolve!: (v: ComponentCatalogEntry) => void;
    const { api, getComponent } = mockApi(
      () => new Promise<ComponentCatalogEntry>((r) => (resolve = r))
    );

    const a = fetchComponent(api, "binary_sensor.gpio", "esp32");
    const b = fetchComponent(api, "binary_sensor.gpio", "esp32");
    const c = fetchComponent(api, "binary_sensor.gpio", "esp32");

    expect(getComponent).toHaveBeenCalledTimes(1);
    resolve(entry("binary_sensor.gpio", "GPIO Binary Sensor"));

    await expect(a).resolves.toMatchObject({ name: "GPIO Binary Sensor" });
    await expect(b).resolves.toMatchObject({ name: "GPIO Binary Sensor" });
    await expect(c).resolves.toMatchObject({ name: "GPIO Binary Sensor" });
    expect(getComponent).toHaveBeenCalledTimes(1);
  });

  it("keys cache entries by component id, platform, and board id", async () => {
    const { api, getComponent } = mockApi((id, platform) =>
      entry(id, `${id}|${platform ?? ""}`)
    );

    await fetchComponent(api, "sensor.dht", "esp32");
    await fetchComponent(api, "sensor.dht", "esp8266");
    await fetchComponent(api, "sensor.dht");

    expect(getComponent).toHaveBeenCalledTimes(3);
    expect(getCachedComponent("sensor.dht", "esp32")?.name).toBe("sensor.dht|esp32");
    expect(getCachedComponent("sensor.dht", "esp8266")?.name).toBe("sensor.dht|esp8266");
    expect(getCachedComponent("sensor.dht")?.name).toBe("sensor.dht|");
  });

  it("caches null (catalog miss) so unknown ids aren't re-fetched", async () => {
    const { api, getComponent } = mockApi(() => null);

    const first = await fetchComponent(api, "nonsense.id");
    expect(first).toBeNull();
    expect(getCachedComponent("nonsense.id")).toBeNull();

    await fetchComponent(api, "nonsense.id");
    expect(getComponent).toHaveBeenCalledTimes(1);
  });

  it("does not cache transport errors (allows retry)", async () => {
    let attempts = 0;
    const { api } = mockApi(() => {
      attempts++;
      if (attempts === 1) return Promise.reject(new Error("network down"));
      return entry("wifi", "WiFi");
    });

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

  it("notifies subscribers exactly once per fresh entry", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeComponentCache(listener);

    const { api } = mockApi(() => entry("api", "API"));
    await fetchComponent(api, "api");

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
