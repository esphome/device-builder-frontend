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
 * promise, so a navigator that mounts and dispatches N parallel
 * resolves only triggers N unique backend calls.
 */

type CacheValue = ComponentCatalogEntry | null;

const _cache = new Map<string, CacheValue>();
const _inflight = new Map<string, Promise<CacheValue>>();
const _listeners = new Set<() => void>();

function _key(componentId: string, platform?: string, boardId?: string): string {
  return `${componentId}|${platform ?? ""}|${boardId ?? ""}`;
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

  const promise = api
    .getComponent(componentId, platform, boardId)
    .then((entry) => {
      _cache.set(key, entry ?? null);
      _inflight.delete(key);
      _notify();
      return entry ?? null;
    })
    .catch((err) => {
      _inflight.delete(key);
      throw err;
    });

  _inflight.set(key, promise);
  return promise;
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

/** Test-only: drop all cached entries and pending promises. */
export function _clearComponentCache(): void {
  _cache.clear();
  _inflight.clear();
  _listeners.clear();
}
