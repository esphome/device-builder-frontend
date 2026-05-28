import { describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import { BatchedCache } from "../../src/util/batched-cache.js";

interface Ctx {
  platform: string;
}

const makeApi = () => ({ getComponentBodies: vi.fn() }) as unknown as ESPHomeAPI;

describe("BatchedCache", () => {
  it("clear() during an in-flight fetch rejects waiters and doesn't repopulate the cache", async () => {
    let resolveFetch!: (v: Record<string, string>) => void;
    const fetcher = vi.fn(
      (_api: ESPHomeAPI, _keys: string[]): Promise<Record<string, string>> =>
        new Promise<Record<string, string>>((r) => (resolveFetch = r))
    );
    const cache = new BatchedCache<string, Ctx>({
      name: "clear-race",
      bucketKey: (ctx) => ctx.platform,
      fetch: fetcher,
    });
    const api = makeApi();

    const pending = cache.fetch(api, "wifi", { platform: "esp32" });
    // Let the microtask flush so the fetcher is in-flight (past
    // the await point, bucket already removed from ``_batches``).
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledTimes(1);

    cache.clear();
    resolveFetch({ wifi: "would-be-stale" });

    await expect(pending).rejects.toThrow("clear-race cleared");
    expect(cache.getCached("wifi", { platform: "esp32" })).toBeUndefined();
  });

  it("caches misses by default so unknown keys aren't re-fetched", async () => {
    const fetcher = vi.fn(
      (_api: ESPHomeAPI, _keys: string[]): Promise<Record<string, string>> =>
        Promise.resolve({})
    );
    const cache = new BatchedCache<string, Ctx>({
      name: "default-misses",
      bucketKey: (ctx) => ctx.platform,
      fetch: fetcher,
    });
    const api = makeApi();

    await cache.fetch(api, "ghost", { platform: "esp32" });
    expect(cache.getCached("ghost", { platform: "esp32" })).toBeNull();
    await cache.fetch(api, "ghost", { platform: "esp32" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("with cacheMisses: false re-fetches advertised keys whose body was absent", async () => {
    let attempts = 0;
    const fetcher = vi.fn(
      (_api: ESPHomeAPI, _keys: string[]): Promise<Record<string, string>> => {
        attempts++;
        const out: Record<string, string> = attempts === 1 ? {} : { ghost: "recovered" };
        return Promise.resolve(out);
      }
    );
    const cache = new BatchedCache<string, Ctx>({
      name: "no-miss-cache",
      bucketKey: (ctx) => ctx.platform,
      fetch: fetcher,
      cacheMisses: false,
    });
    const api = makeApi();

    const first = await cache.fetch(api, "ghost", { platform: "esp32" });
    expect(first).toBeNull();
    expect(cache.getCached("ghost", { platform: "esp32" })).toBeUndefined();

    const second = await cache.fetch(api, "ghost", { platform: "esp32" });
    expect(second).toBe("recovered");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not collide when keys or bucket-keys contain the | delimiter", async () => {
    // Two callers whose flat ``${key}|${bucketKey}`` composition
    // would collide (``a|b`` + ``c`` and ``a`` + ``b|c``) MUST stay
    // distinct under the nested-map keying.
    const fetcher = vi.fn(
      (_api: ESPHomeAPI, keys: string[], ctx: Ctx): Promise<Record<string, string>> => {
        const result: Record<string, string> = {};
        for (const k of keys) result[k] = `${k}@${ctx.platform}`;
        return Promise.resolve(result);
      }
    );
    const cache = new BatchedCache<string, Ctx>({
      name: "test",
      bucketKey: (ctx) => ctx.platform,
      fetch: fetcher,
    });
    const api = makeApi();

    const [a, b] = await Promise.all([
      cache.fetch(api, "a|b", { platform: "c" }),
      cache.fetch(api, "a", { platform: "b|c" }),
    ]);

    expect(a).toBe("a|b@c");
    expect(b).toBe("a@b|c");
    expect(cache.getCached("a|b", { platform: "c" })).toBe("a|b@c");
    expect(cache.getCached("a", { platform: "b|c" })).toBe("a@b|c");
    // Different buckets → distinct fetcher invocations.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
