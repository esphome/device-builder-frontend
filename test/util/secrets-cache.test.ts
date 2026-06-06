import { afterEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import {
  _resetSecretKeysCache,
  fetchSecretKeys,
  getCachedSecretKeys,
  refreshSecretKeys,
  subscribeSecretKeys,
} from "../../src/util/secrets-cache.js";

const makeApi = (impl: () => Promise<string[]>): ESPHomeAPI =>
  ({ getSecretKeys: vi.fn(impl) }) as unknown as ESPHomeAPI;

afterEach(() => {
  _resetSecretKeysCache();
});

describe("secrets-cache", () => {
  it("fetches once and memoizes; concurrent callers share the promise", async () => {
    const api = makeApi(async () => ["wifi_ssid", "wifi_password"]);

    const [a, b] = await Promise.all([fetchSecretKeys(api), fetchSecretKeys(api)]);

    expect(a).toEqual(["wifi_ssid", "wifi_password"]);
    expect(b).toBe(a);
    await fetchSecretKeys(api);
    expect(api.getSecretKeys).toHaveBeenCalledTimes(1);
    expect(getCachedSecretKeys()).toEqual(["wifi_ssid", "wifi_password"]);
  });

  it("notifies subscribers when the list populates", async () => {
    const cb = vi.fn();
    subscribeSecretKeys(cb);

    await fetchSecretKeys(makeApi(async () => []));

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("caches an empty list on fetch failure so it doesn't retry-storm", async () => {
    const api = makeApi(async () => {
      throw new Error("ws down");
    });

    expect(await fetchSecretKeys(api)).toEqual([]);
    await fetchSecretKeys(api);
    expect(api.getSecretKeys).toHaveBeenCalledTimes(1);
  });

  it("refreshSecretKeys re-hits the wire and notifies with the new list", async () => {
    let keys = ["wifi_ssid"];
    const api = makeApi(async () => keys);
    await fetchSecretKeys(api);
    expect(getCachedSecretKeys()).toEqual(["wifi_ssid"]);

    const cb = vi.fn();
    subscribeSecretKeys(cb);
    keys = ["wifi_ssid", "wifi_password"];
    await refreshSecretKeys(api);

    expect(api.getSecretKeys).toHaveBeenCalledTimes(2);
    expect(getCachedSecretKeys()).toEqual(["wifi_ssid", "wifi_password"]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("refreshSecretKeys keeps the cached list when the refetch fails", async () => {
    let fail = false;
    const api = makeApi(async () => {
      if (fail) throw new Error("ws blip");
      return ["wifi_ssid"];
    });
    await fetchSecretKeys(api);

    fail = true;
    await refreshSecretKeys(api);

    expect(getCachedSecretKeys()).toEqual(["wifi_ssid"]);
  });

  it("refreshSecretKeys de-dupes concurrent callers into one wire request", async () => {
    // N pickers reacting to the same `secrets-saved` event must not each hit
    // the wire.
    const api = makeApi(async () => ["wifi_ssid"]);
    await Promise.all([
      refreshSecretKeys(api),
      refreshSecretKeys(api),
      refreshSecretKeys(api),
    ]);
    expect(api.getSecretKeys).toHaveBeenCalledTimes(1);
  });
});
