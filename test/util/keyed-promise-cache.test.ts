import { describe, expect, it, vi } from "vitest";

import { deferred } from "../_dom.js";
import { KeyedPromiseCache } from "../../src/util/keyed-promise-cache.js";

describe("KeyedPromiseCache", () => {
  it("dedupes concurrent callers on one in-flight promise per key", async () => {
    const create = vi.fn(async () => "value");
    const cache = new KeyedPromiseCache<string>();

    const a = cache.fetch("k", create);
    const b = cache.fetch("k", create);
    expect(b).toBe(a);
    expect(await a).toBe("value");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("memoises per key — distinct keys each run their own fetch", async () => {
    const create = vi.fn(async (key: string) => key.toUpperCase());
    const cache = new KeyedPromiseCache<string>();

    expect(await cache.fetch("x", () => create("x"))).toBe("X");
    expect(await cache.fetch("y", () => create("y"))).toBe("Y");
    expect(await cache.fetch("x", () => create("x"))).toBe("X");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("keeps a resolved promise cached — later calls don't refetch", async () => {
    const create = vi.fn(async () => ["a"]);
    const cache = new KeyedPromiseCache<string[]>();

    const first = await cache.fetch("k", create);
    const second = await cache.fetch("k", create);
    expect(second).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("evicts a rejected promise so the next call retries", async () => {
    let attempt = 0;
    const create = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("transient");
      return "ok";
    });
    const cache = new KeyedPromiseCache<string>();

    await expect(cache.fetch("k", create)).rejects.toThrow("transient");
    expect(await cache.fetch("k", create)).toBe("ok");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("shares the in-flight promise with callers that arrive before the rejection", async () => {
    let reject!: (err: Error) => void;
    const create = vi.fn(
      () =>
        new Promise<string>((_resolve, rej) => {
          reject = rej;
        })
    );
    const cache = new KeyedPromiseCache<string>();

    const a = cache.fetch("k", create);
    const b = cache.fetch("k", create);
    expect(b).toBe(a);
    reject(new Error("boom"));
    await expect(a).rejects.toThrow("boom");
    await expect(b).rejects.toThrow("boom");
    // Both callers replayed one attempt; the eviction happened after.
    expect(create).toHaveBeenCalledTimes(1);
    const retry = cache.fetch("k", create);
    expect(create).toHaveBeenCalledTimes(2);
    // Settle the retry too so no in-flight promise dangles past the test.
    reject(new Error("boom again"));
    await expect(retry).rejects.toThrow("boom again");
  });

  it("with evictOnReject: false, a rejection is memoised and replayed", async () => {
    const create = vi.fn(async () => {
      throw new Error("permanent");
    });
    const cache = new KeyedPromiseCache<string>({ evictOnReject: false });

    await expect(cache.fetch("k", create)).rejects.toThrow("permanent");
    await expect(cache.fetch("k", create)).rejects.toThrow("permanent");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("with evictOnSettle, shares the in-flight promise and drops it once settled", async () => {
    const create = vi.fn(async () => "value");
    const cache = new KeyedPromiseCache<string>({ evictOnSettle: true });

    const a = cache.fetch("k", create);
    expect(cache.fetch("k", create)).toBe(a);
    await a;
    await Promise.resolve();
    void cache.fetch("k", create);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("with evictOnSettle, a rejection is dropped too", async () => {
    const create = vi.fn(async () => {
      throw new Error("boom");
    });
    const cache = new KeyedPromiseCache<string>({ evictOnSettle: true });
    await expect(cache.fetch("k", create)).rejects.toThrow("boom");
    await Promise.resolve();
    await expect(cache.fetch("k", create)).rejects.toThrow("boom");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("with evictOnSettle, a stale settle doesn't evict a fresh entry cached after clear()", async () => {
    const first = deferred<string>();
    const cache = new KeyedPromiseCache<string>({ evictOnSettle: true });
    void cache.fetch("k", () => first.promise);
    cache.clear();
    const fresh = cache.fetch("k", () => new Promise<string>(() => {}));
    first.resolve("old");
    await first.promise;
    await Promise.resolve();
    expect(cache.fetch("k", () => Promise.resolve("new"))).toBe(fresh);
  });

  it("clear() drops entries so the next call refetches", async () => {
    const create = vi.fn(async () => "value");
    const cache = new KeyedPromiseCache<string>();

    await cache.fetch("k", create);
    cache.clear();
    await cache.fetch("k", create);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("a stale rejection doesn't evict a fresh entry cached after clear()", async () => {
    let reject!: (err: Error) => void;
    const cache = new KeyedPromiseCache<string>();

    const stale = cache.fetch(
      "k",
      () =>
        new Promise<string>((_resolve, rej) => {
          reject = rej;
        })
    );
    stale.catch(() => {}); // the caller handles it; this test cares about the cache
    cache.clear();
    const freshCreate = vi.fn(async () => "fresh");
    await cache.fetch("k", freshCreate);
    reject(new Error("stale"));
    await Promise.resolve(); // let the eviction listener run
    // The fresh entry survives — no refetch.
    expect(await cache.fetch("k", freshCreate)).toBe("fresh");
    expect(freshCreate).toHaveBeenCalledTimes(1);
  });
});
