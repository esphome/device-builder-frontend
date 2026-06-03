import type { ESPHomeAPI } from "../api/esphome-api.js";

/**
 * A fetch-once session cache for a whole immutable payload, keyed by a
 * string derived from the fetch arguments. Concurrent callers for the
 * same key share one in-flight promise; the resolved value is held for
 * the session. Single-global caches are just the keyed case with one
 * fixed ``""`` key (omit ``key``).
 *
 * This is distinct from :class:`BatchedCache` (`batched-cache.ts`),
 * which is per-key / microtask-batched / consumer-driven — the wrong
 * shape for "read one whole list/map at once". Both
 * ``pin-registry-modes-cache`` and ``automation-catalog-cache`` are
 * built on this.
 *
 * Failure policy is the ``fallback`` option:
 * - present → the rejection is swallowed, ``fallback(err)`` is cached
 *   and broadcast, and ``fetch`` resolves to it (so renders don't
 *   retry-storm; the callback owns any logging).
 * - absent → the rejection propagates and nothing is cached, so the
 *   next call retries.
 */
export interface SessionBlobCache<T, A extends unknown[]> {
  /** Cached value for these args, or ``undefined`` until first resolve. */
  getCached(...args: A): T | undefined;
  /** Fetch once per key; concurrent callers share the in-flight promise. */
  fetch(api: ESPHomeAPI, ...args: A): Promise<T>;
  /** Overwrite a key's cached value and notify subscribers — for an
   *  external mutation (e.g. post-fetch hydration swapping identity). */
  update(value: T, ...args: A): void;
  /** Subscribe to cache updates; returns an unsubscribe function. */
  subscribe(cb: () => void): () => void;
  /** Test-only: drop cached values, in-flight fetches, and listeners. */
  reset(): void;
}

export interface SessionBlobCacheOptions<T, A extends unknown[]> {
  /** Label used in the listener-threw log line. */
  name: string;
  fetch: (api: ESPHomeAPI, ...args: A) => Promise<T>;
  /** Cache key from the fetch args. Defaults to a single ``""`` key. */
  key?: (...args: A) => string;
  /** Failure fallback — see the interface doc. Omit to rethrow. */
  fallback?: (err: unknown) => T;
}

export function createSessionBlobCache<T, A extends unknown[] = []>(
  opts: SessionBlobCacheOptions<T, A>
): SessionBlobCache<T, A> {
  const keyOf = opts.key ?? (() => "");
  const cache = new Map<string, T>();
  const inflight = new Map<string, Promise<T>>();
  const listeners = new Set<() => void>();
  // Bumped by reset(); a fetch captures it at call time so a stale
  // promise that resolves after a reset no-ops its cache write / notify
  // (it still resolves the original callers) instead of repopulating a
  // reset cache or notifying listeners added since.
  let generation = 0;

  // Isolate each listener so a throwing subscriber can't reject the fetch
  // promise (the cache is already populated here) or skip later listeners.
  const notify = (): void => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (err) {
        console.error(`${opts.name} listener threw`, err);
      }
    }
  };

  return {
    getCached(...args: A): T | undefined {
      return cache.get(keyOf(...args));
    },

    fetch(api: ESPHomeAPI, ...args: A): Promise<T> {
      const key = keyOf(...args);
      if (cache.has(key)) return Promise.resolve(cache.get(key) as T);
      const existing = inflight.get(key);
      if (existing) return existing;

      const gen = generation;
      // Call the fetcher eagerly (callers rely on the request firing
      // synchronously), but funnel a synchronous throw into a rejection so
      // it flows through the fallback / rethrow path below rather than
      // escaping fetch() directly.
      let started: Promise<T>;
      try {
        started = opts.fetch(api, ...args);
      } catch (err) {
        started = Promise.reject(err);
      }
      const promise = started
        .then((value) => {
          if (gen === generation) {
            cache.set(key, value);
            inflight.delete(key);
            notify();
          }
          return value;
        })
        .catch((err: unknown) => {
          if (gen === generation) inflight.delete(key);
          if (opts.fallback === undefined) throw err;
          const value = opts.fallback(err);
          if (gen === generation) {
            cache.set(key, value);
            notify();
          }
          return value;
        });
      inflight.set(key, promise);
      return promise;
    },

    update(value: T, ...args: A): void {
      cache.set(keyOf(...args), value);
      notify();
    },

    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },

    reset(): void {
      generation += 1;
      cache.clear();
      inflight.clear();
      listeners.clear();
    },
  };
}
