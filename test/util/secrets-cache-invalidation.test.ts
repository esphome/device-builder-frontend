/**
 * @vitest-environment happy-dom
 *
 * Pins that a window ``secrets-saved`` event refreshes the shared secrets
 * cache once (reusing the last api), so every mounted picker sees the new
 * list and the next picker to mount reads it too — without flashing empty.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import {
  _resetSecretKeysCache,
  fetchSecretKeys,
  getCachedSecretKeys,
  subscribeSecretKeys,
} from "../../src/util/secrets-cache.js";
import { flush } from "../_dom.js";

const makeApi = (impl: () => Promise<string[]>): ESPHomeAPI =>
  ({ getSecretKeys: vi.fn(impl) }) as unknown as ESPHomeAPI;

afterEach(() => {
  _resetSecretKeysCache();
});

describe("secrets-cache refresh on secrets-saved", () => {
  it("refreshes the cached list and notifies subscribers after a save", async () => {
    let keys = ["wifi_ssid"];
    const api = makeApi(async () => keys);

    await fetchSecretKeys(api);
    expect(getCachedSecretKeys()).toEqual(["wifi_ssid"]);
    const cb = vi.fn();
    subscribeSecretKeys(cb);

    // A save elsewhere refreshes the cache in place (no empty flash).
    keys = ["wifi_ssid", "fresh_secret"];
    window.dispatchEvent(new CustomEvent("secrets-saved", { detail: { source: {} } }));
    await flush();

    expect(api.getSecretKeys).toHaveBeenCalledTimes(2);
    expect(getCachedSecretKeys()).toEqual(["wifi_ssid", "fresh_secret"]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("does nothing before any fetch has provided an api", async () => {
    // No picker ever mounted → no api captured → the handler is a no-op.
    window.dispatchEvent(new CustomEvent("secrets-saved", { detail: { source: {} } }));
    await flush();
    expect(getCachedSecretKeys()).toBeUndefined();
  });
});
