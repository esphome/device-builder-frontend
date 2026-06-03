import type { ESPHomeAPI } from "../api/esphome-api.js";
import { createSessionBlobCache } from "./session-blob-cache.js";

/**
 * Session cache of the ``{provider_key: [allowed_mode_flags]}`` map
 * (`components/get_pin_registry_modes`), fetched once and shared across pin
 * renderers. A failed fetch caches ``{}`` so renders don't retry-storm.
 */

const _cache = createSessionBlobCache<Record<string, string[]>>({
  name: "pin-registry-modes",
  fetch: (api) => api.getPinRegistryModes(),
  fallback: (err) => {
    // Cache an empty map so renders don't retry-storm; log so the lost
    // scoping shows. Null-prototype to match the populated map's shape.
    console.warn("pin-registry-modes fetch failed; Mode flags unscoped", err);
    return Object.create(null) as Record<string, string[]>;
  },
});

/** Read the cached map; ``undefined`` until the first fetch resolves. */
export function getCachedPinRegistryModes(): Record<string, string[]> | undefined {
  return _cache.getCached();
}

/** Subscribe to cache population; returns an unsubscribe function. */
export function subscribePinRegistryModes(cb: () => void): () => void {
  return _cache.subscribe(cb);
}

/** Fetch once per session; concurrent callers share the in-flight promise. */
export function fetchPinRegistryModes(
  api: ESPHomeAPI
): Promise<Record<string, string[]>> {
  return _cache.fetch(api);
}

/** Test-only: reset the cached map, in-flight fetch, and listeners. */
export function _resetPinRegistryModesCache(): void {
  _cache.reset();
}
