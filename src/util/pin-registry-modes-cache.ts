import type { ESPHomeAPI } from "../api/esphome-api.js";

/**
 * Session cache of the ``{provider_key: [allowed_mode_flags]}`` map
 * (`components/get_pin_registry_modes`), fetched once and shared across pin
 * renderers. A failed fetch caches ``{}`` so renders don't retry-storm.
 */

let _cache: Record<string, string[]> | undefined;
let _inflight: Promise<Record<string, string[]>> | undefined;
const _listeners = new Set<() => void>();

/** Read the cached map; ``undefined`` until the first fetch resolves. */
export function getCachedPinRegistryModes(): Record<string, string[]> | undefined {
  return _cache;
}

/** Subscribe to cache population; returns an unsubscribe function. */
export function subscribePinRegistryModes(cb: () => void): () => void {
  _listeners.add(cb);
  return () => {
    _listeners.delete(cb);
  };
}

/** Fetch once per session; concurrent callers share the in-flight promise. */
export function fetchPinRegistryModes(
  api: ESPHomeAPI
): Promise<Record<string, string[]>> {
  if (_cache) return Promise.resolve(_cache);
  if (!_inflight) {
    _inflight = api
      .getPinRegistryModes()
      .catch((err) => {
        // Cache an empty map so renders don't retry-storm; log so the lost
        // scoping shows. Null-prototype to match the populated map's shape.
        console.warn("pin-registry-modes fetch failed; Mode flags unscoped", err);
        return Object.create(null) as Record<string, string[]>;
      })
      .then((modes) => {
        _cache = modes;
        _inflight = undefined;
        // Isolate listeners so one throw can't break others or reject this promise.
        for (const cb of _listeners) {
          try {
            cb();
          } catch (err) {
            console.error("pin-registry-modes listener threw", err);
          }
        }
        return modes;
      });
  }
  return _inflight;
}

/** Test-only: reset the cached map, in-flight fetch, and listeners. */
export function _resetPinRegistryModesCache(): void {
  _cache = undefined;
  _inflight = undefined;
  _listeners.clear();
}
