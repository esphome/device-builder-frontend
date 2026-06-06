import type { ESPHomeAPI } from "../api/esphome-api.js";
import { createSessionBlobCache } from "./session-blob-cache.js";

/**
 * Session cache of the ``secrets.yaml`` key names (`config/get_secrets`),
 * shared by every picker. Failed fetch caches ``[]`` so renders don't
 * retry-storm. The set is mutable (the secrets editor rewrites the file), so
 * a `secrets-saved` event refreshes it once for all mounted pickers.
 */

const _cache = createSessionBlobCache<string[]>({
  name: "secret-keys",
  fetch: (api) => api.getSecretKeys(),
  fallback: (err) => {
    // Cache an empty list so renders don't retry-storm; log so the lost
    // picker contents show.
    console.warn("secret-keys fetch failed; secret picker empty", err);
    return [];
  },
});

/** The api a picker last used. The event-driven refresh below has no api of
 *  its own, so it reuses the most recent one (a single per-session WS client). */
let _lastApi: ESPHomeAPI | undefined;
/** One in-flight refresh shared across the N pickers that all hear the same
 *  `secrets-saved` event, so a save triggers a single wire request. */
let _refreshInFlight: Promise<void> | undefined;

// A save anywhere (the secrets editor on its own route, or a migrate from a
// picker) rewrote secrets.yaml. Refresh the shared cache once so every mounted
// picker updates and the next picker to mount reads the new list. Refresh —
// not invalidate — so a failed refetch keeps the prior list instead of
// flashing empty. Guarded for the non-DOM test environment.
if (typeof window !== "undefined") {
  window.addEventListener("secrets-saved", () => {
    if (_lastApi) void refreshSecretKeys(_lastApi);
  });
}

/** Read the cached keys; ``undefined`` until the first fetch resolves. */
export function getCachedSecretKeys(): string[] | undefined {
  return _cache.getCached();
}

/** Subscribe to cache population / refresh; returns an unsubscribe function. */
export function subscribeSecretKeys(cb: () => void): () => void {
  return _cache.subscribe(cb);
}

/** Fetch once per session; concurrent callers share the in-flight promise. */
export function fetchSecretKeys(api: ESPHomeAPI): Promise<string[]> {
  _lastApi = api;
  return _cache.fetch(api);
}

/** Re-read the keys and overwrite the cache. Concurrent callers (one per
 *  mounted picker reacting to the same event) share a single in-flight
 *  request. Swallows errors so a WS blip keeps the cached list. */
export function refreshSecretKeys(api: ESPHomeAPI): Promise<void> {
  _lastApi = api;
  if (_refreshInFlight) return _refreshInFlight;
  // `Promise.resolve().then` funnels a synchronous throw from getSecretKeys
  // into the catch instead of letting it escape this call (and, when invoked
  // from the window event handler, abort other `secrets-saved` listeners).
  _refreshInFlight = Promise.resolve()
    .then(() => api.getSecretKeys())
    .then((keys) => {
      _cache.update(keys);
    })
    .catch((err: unknown) => {
      console.warn("secret-keys refresh failed; keeping cached list", err);
    })
    .finally(() => {
      _refreshInFlight = undefined;
    });
  return _refreshInFlight;
}

/** Test-only: reset the cached list, in-flight fetch, listeners, and the
 *  module-level refresh state. */
export function _resetSecretKeysCache(): void {
  _cache.reset();
  _lastApi = undefined;
  _refreshInFlight = undefined;
}
