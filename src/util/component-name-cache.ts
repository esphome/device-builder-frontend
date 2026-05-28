import type { ESPHomeAPI } from "../api/index.js";
import type { ComponentCatalogEntry } from "../api/types.js";

/**
 * Session-scoped cache of component catalog entries, keyed by
 * `componentId|platform|boardId`. Used by the device navigator to
 * resolve raw `domain.platform` ids (e.g. `binary_sensor.gpio`) into
 * friendly catalog names (e.g. "GPIO Binary Sensor") without
 * re-fetching across renders, devices, or navigations.
 *
 * The backend catalog is loaded from a static JSON file at startup
 * and is immutable for the lifetime of the process, so cache entries
 * never need invalidation. `null` is cached too (catalog miss) to
 * avoid re-fetching unknown ids; transport errors are not cached so
 * the next call retries.
 *
 * Concurrent fetches for the same key share a single in-flight
 * promise; in addition, every `fetchComponent` call enqueues onto a
 * microtask-flushed batch so a navigator that mounts N components in
 * one task triggers one `components/get_component_bodies` WS call
 * instead of N singletons. Different `(platform, boardId)` contexts
 * batch separately because the backend resolves platform_defaults
 * per call.
 */

type CacheValue = ComponentCatalogEntry | null;

interface _PendingResolver {
  resolve: (value: CacheValue) => void;
  reject: (reason: unknown) => void;
}

interface _BatchBucket {
  api: ESPHomeAPI;
  platform: string | undefined;
  boardId: string | undefined;
  // One resolver per id. ``_inflight`` short-circuits same-id
  // duplicates before they reach the bucket, so this never needs
  // to fan out to a list.
  pending: Map<string, _PendingResolver>;
}

const _cache = new Map<string, CacheValue>();
const _inflight = new Map<string, Promise<CacheValue>>();
const _listeners = new Set<() => void>();
const _batches = new Map<string, _BatchBucket>();

function _key(componentId: string, platform?: string, boardId?: string): string {
  return `${componentId}|${platform ?? ""}|${boardId ?? ""}`;
}

function _batchKey(platform?: string, boardId?: string): string {
  return `${platform ?? ""}|${boardId ?? ""}`;
}

/**
 * Synchronous read. Returns the cached entry (or `null` for a known
 * catalog miss), or `undefined` when this key has never been fetched.
 * Callers typically use this from render and fall back to the raw id
 * when the result is `undefined` or `null`.
 */
export function getCachedComponent(
  componentId: string,
  platform?: string,
  boardId?: string
): CacheValue | undefined {
  return _cache.get(_key(componentId, platform, boardId));
}

/**
 * Fetch a component, populating the cache. Subsequent calls with the
 * same key return the cached value (or join the in-flight promise).
 * Notifies subscribers once after a fresh entry lands so reactive
 * consumers can re-render.
 *
 * Calls within the same microtask coalesce into one batched
 * `components/get_component_bodies` request, so a navigator that
 * fans out N parallel resolves pays one round trip.
 */
export function fetchComponent(
  api: ESPHomeAPI,
  componentId: string,
  platform?: string,
  boardId?: string
): Promise<CacheValue> {
  const key = _key(componentId, platform, boardId);
  if (_cache.has(key)) return Promise.resolve(_cache.get(key) ?? null);

  const existing = _inflight.get(key);
  if (existing) return existing;

  const promise = new Promise<CacheValue>((resolve, reject) => {
    const bucketKey = _batchKey(platform, boardId);
    let bucket = _batches.get(bucketKey);
    if (bucket === undefined) {
      // Bucket captures the first caller's `api`. Assumes one
      // live `ESPHomeAPI` per app (context-provided by app-shell);
      // a future second instance would need `api` in the bucket key.
      bucket = { api, platform, boardId, pending: new Map() };
      _batches.set(bucketKey, bucket);
      queueMicrotask(() => _flushBatch(bucketKey));
    }
    bucket.pending.set(componentId, { resolve, reject });
  }).finally(() => {
    _inflight.delete(key);
  });

  _inflight.set(key, promise);
  return promise;
}

async function _flushBatch(bucketKey: string): Promise<void> {
  const bucket = _batches.get(bucketKey);
  if (bucket === undefined) return;
  _batches.delete(bucketKey);
  const ids = Array.from(bucket.pending.keys());
  let entries: Record<string, ComponentCatalogEntry>;
  try {
    entries = await bucket.api.getComponentBodies(ids, bucket.platform, bucket.boardId);
  } catch (err) {
    // Surface the transport error to every waiter so callers can
    // retry; do NOT populate the cache, mirroring the singleton
    // path's "transport errors are not cached" contract.
    for (const resolver of bucket.pending.values()) {
      resolver.reject(err);
    }
    return;
  }
  for (const [componentId, resolver] of bucket.pending) {
    // Own-property check rather than `entries[id] ?? null`: the
    // wire payload is a plain object, so a bare index lookup would
    // resolve `toString`, `constructor`, etc. via the prototype
    // chain and cache that garbage as a "found" entry. Reachable
    // from user-typed yaml-completion ids.
    const entry = Object.prototype.hasOwnProperty.call(entries, componentId)
      ? entries[componentId]
      : null;
    // Cache write MUST precede resolve. A sync `_notify` subscriber
    // that re-calls `fetchComponent(api, id, ...)` hits the cache
    // path; reordering would start a fresh round trip for an id
    // we just resolved.
    _cache.set(_key(componentId, bucket.platform, bucket.boardId), entry);
    resolver.resolve(entry);
  }
  // Notify outside the response try so a throwing subscriber
  // surfaces via `_notify`'s own try/catch instead of getting
  // turned into a rejection of already-settled resolvers.
  _notify();
}

/**
 * Subscribe to cache updates. Returns an unsubscribe function.
 * Listeners fire once per fresh entry; failed fetches do not fire.
 */
export function subscribeComponentCache(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

function _notify(): void {
  // Isolate each listener: a throwing subscriber would otherwise
  // reject `fetchComponent`'s promise (the cache is already populated
  // at this point, so the rejection is misleading) and skip later
  // listeners that haven't been notified yet.
  for (const listener of _listeners) {
    try {
      listener();
    } catch (err) {
      console.error("component-name-cache listener threw", err);
    }
  }
}

/** Test-only: drop all cached entries and pending promises.
 *  Bucket waiters waiting on a flush that will never happen are
 *  rejected so the dangling promises settle and dependent tests
 *  don't hang on an `await fetchComponent(...)`. Attach a noop
 *  catch to each in-flight promise first so a test that fired
 *  `fetchComponent` purely for cache side-effects (no await, no
 *  catch) doesn't surface the rejection as
 *  ``unhandledrejection`` under vitest strict mode. */
export function _clearComponentCache(): void {
  for (const promise of _inflight.values()) {
    promise.catch(() => {});
  }
  for (const bucket of _batches.values()) {
    for (const resolver of bucket.pending.values()) {
      resolver.reject(new Error("component cache cleared"));
    }
  }
  _cache.clear();
  _inflight.clear();
  _listeners.clear();
  _batches.clear();
}
