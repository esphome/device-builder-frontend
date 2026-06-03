import { describe, expect, it, vi } from "vitest";

import type { ESPHomeAPI } from "../../src/api/esphome-api.js";
import { createSessionBlobCache } from "../../src/util/session-blob-cache.js";

// The helper only forwards ``api`` to ``opts.fetch``; tests that don't
// exercise a real client pass this stand-in.
const API = {} as ESPHomeAPI;

describe("createSessionBlobCache", () => {
  it("fetches once per key and shares the in-flight promise", async () => {
    const fetch = vi.fn(async () => ["a"]);
    const cache = createSessionBlobCache<string[]>({ name: "t", fetch });

    const [a, b] = await Promise.all([cache.fetch(API), cache.fetch(API)]);
    expect(a).toEqual(["a"]);
    expect(b).toBe(a);
    await cache.fetch(API);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.getCached()).toBe(a);
  });

  it("buckets by the derived key", async () => {
    const fetch = vi.fn(async (_api: ESPHomeAPI, p?: string) => [p ?? "none"]);
    const cache = createSessionBlobCache<string[], [string?]>({
      name: "t",
      key: (p) => p ?? "",
      fetch,
    });

    expect(await cache.fetch(API, "x")).toEqual(["x"]);
    expect(await cache.fetch(API, "y")).toEqual(["y"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(cache.getCached("x")).toEqual(["x"]);
    expect(cache.getCached("y")).toEqual(["y"]);
    expect(cache.getCached("z")).toBeUndefined();
  });

  it("with a fallback: caches it, notifies, and resolves (no retry-storm)", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("boom");
    });
    const onNotify = vi.fn();
    const cache = createSessionBlobCache<Record<string, string[]>>({
      name: "t",
      fetch,
      fallback: () => Object.create(null) as Record<string, string[]>,
    });
    cache.subscribe(onNotify);

    const value = await cache.fetch(API);
    expect(value).toEqual({});
    expect(onNotify).toHaveBeenCalledTimes(1);
    // Cached → no second fetch.
    await cache.fetch(API);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(cache.getCached()).toBe(value);
  });

  it("without a fallback: rejects, doesn't cache, and retries next call", async () => {
    let attempt = 0;
    const fetch = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("transient");
      return ["ok"];
    });
    const onNotify = vi.fn();
    const cache = createSessionBlobCache<string[]>({ name: "t", fetch });
    cache.subscribe(onNotify);

    await expect(cache.fetch(API)).rejects.toThrow("transient");
    expect(cache.getCached()).toBeUndefined();
    expect(onNotify).not.toHaveBeenCalled(); // failed fetch doesn't notify
    // Retry succeeds and caches.
    expect(await cache.fetch(API)).toEqual(["ok"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onNotify).toHaveBeenCalledTimes(1);
  });

  it("normalizes a synchronous throw in the fetcher into the failure path", async () => {
    // no fallback → rejects (not a sync throw out of fetch())
    const cache = createSessionBlobCache<string[]>({
      name: "t",
      fetch: () => {
        throw new Error("sync boom");
      },
    });
    await expect(cache.fetch(API)).rejects.toThrow("sync boom");
    expect(cache.getCached()).toBeUndefined();

    // with fallback → the sync throw is caught and the fallback is cached
    const withFallback = createSessionBlobCache<string[]>({
      name: "t",
      fetch: () => {
        throw new Error("sync boom");
      },
      fallback: () => ["fallback"],
    });
    await expect(withFallback.fetch(API)).resolves.toEqual(["fallback"]);
    expect(withFallback.getCached()).toEqual(["fallback"]);
  });

  it("isolates a throwing listener from others and from the fetch promise", async () => {
    const fetch = vi.fn(async () => ["a"]);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cache = createSessionBlobCache<string[]>({ name: "t", fetch });
    const good = vi.fn();
    cache.subscribe(() => {
      throw new Error("listener boom");
    });
    cache.subscribe(good);

    await expect(cache.fetch(API)).resolves.toEqual(["a"]);
    expect(good).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith("t listener threw", expect.any(Error));
    errSpy.mockRestore();
  });

  it("update() overwrites the cached value and notifies", () => {
    const cache = createSessionBlobCache<string[]>({
      name: "t",
      fetch: async () => ["a"],
    });
    const onNotify = vi.fn();
    cache.subscribe(onNotify);

    cache.update(["b"]);
    expect(cache.getCached()).toEqual(["b"]);
    expect(onNotify).toHaveBeenCalledTimes(1);
  });

  it("reset() clears the cache, in-flight fetch, and listeners", async () => {
    const fetch = vi.fn(async () => ["a"]);
    const cache = createSessionBlobCache<string[]>({ name: "t", fetch });
    const onNotify = vi.fn();
    cache.subscribe(onNotify);

    await cache.fetch(API);
    cache.reset();
    expect(cache.getCached()).toBeUndefined();
    // Listener was dropped; a fresh fetch re-runs and doesn't notify it.
    await cache.fetch(API);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onNotify).toHaveBeenCalledTimes(1); // only the pre-reset fetch
  });

  it("a fetch resolving after reset() no-ops its cache write and notify", async () => {
    let release!: (v: string[]) => void;
    const fetch = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          release = resolve;
        })
    );
    const cache = createSessionBlobCache<string[]>({ name: "t", fetch });

    const pending = cache.fetch(API); // in-flight
    cache.reset();
    const lateListener = vi.fn();
    cache.subscribe(lateListener); // subscribed after the reset

    release(["stale"]);
    await expect(pending).resolves.toEqual(["stale"]); // caller still resolves
    // ...but the post-reset cache stays empty and the late listener is untouched.
    expect(cache.getCached()).toBeUndefined();
    expect(lateListener).not.toHaveBeenCalled();
  });
});
