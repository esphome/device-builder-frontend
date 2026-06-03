import type { ESPHomeAPI } from "../api/esphome-api.js";

/**
 * Session-scoped cache of the ``{provider_key: [allowed_mode_flags]}`` map
 * (`components/get_pin_registry_modes`). The map is immutable for the WS
 * session — it only changes with a backend release — so it's fetched once and
 * shared across every pin renderer rather than re-issued per form. A failed
 * fetch caches an empty map (the editor then shows every flag) so a transient
 * error doesn't retry-storm on each render.
 */

let _cache: Record<string, string[]> | undefined;
let _inflight: Promise<Record<string, string[]>> | undefined;
const _listeners = new Set<() => void>();

/** Synchronously read the cached map; ``undefined`` until the first fetch
 *  resolves (renderers treat that as "show every flag"). */
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
      .catch(() => ({}) as Record<string, string[]>)
      .then((modes) => {
        _cache = modes;
        _inflight = undefined;
        for (const cb of _listeners) cb();
        return modes;
      });
  }
  return _inflight;
}

/** Test-only: drop the cached map and in-flight fetch so a fresh test run
 *  doesn't inherit another's session cache. */
export function _resetPinRegistryModesCache(): void {
  _cache = undefined;
  _inflight = undefined;
}
