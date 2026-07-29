import type { ESPHomeAPI } from "../api/index.js";
import type { ComponentCatalogEntry } from "../api/types/components.js";
import { BatchedCache } from "./batched-cache.js";
import { recordRenamedKeysBatch } from "./renamed-keys.js";

/** Session-scoped cache of component catalog entries, keyed by
 *  ``componentId|platform|boardId``. The backend catalog is
 *  immutable for the process lifetime so entries never need
 *  invalidation; ``null`` is cached for catalog misses. Concurrent
 *  fetches in one microtask coalesce into one
 *  ``components/get_component_bodies`` round trip per bucket.
 *  Different ``(platform, boardId)`` bucket separately because the
 *  backend resolves ``platform_defaults`` per call. */

interface _ComponentContext {
  platform: string | undefined;
  boardId: string | undefined;
}

const _cache = new BatchedCache<ComponentCatalogEntry, _ComponentContext>({
  name: "component-name-cache",
  bucketKey: ({ platform, boardId }) => `${platform ?? ""}|${boardId ?? ""}`,
  fetch: (api, ids, { platform, boardId }) => {
    const bodies = api.getComponentBodies(ids, platform, boardId);
    // Side-tap so recording doesn't delay consumers by a microtask;
    // late hydration is what the registry's subscribe/generation covers.
    // The onRejected arm absorbs transport failures only, so a recording
    // bug reaches the trailing catch and logs instead of vanishing.
    void bodies
      .then(
        (result) =>
          recordRenamedKeysBatch(
            Object.entries(result).map(([id, body]) => [id, body?.renamed_keys] as const)
          ),
        () => {}
      )
      .catch((err) =>
        console.warn("[component-name-cache] renamed-keys hydration failed:", err)
      );
    return bodies;
  },
});

export function getCachedComponent(
  componentId: string,
  platform?: string,
  boardId?: string
): ComponentCatalogEntry | null | undefined {
  return _cache.getCached(componentId, { platform, boardId });
}

export function fetchComponent(
  api: ESPHomeAPI,
  componentId: string,
  platform?: string,
  boardId?: string
): Promise<ComponentCatalogEntry | null> {
  return _cache.fetch(api, componentId, { platform, boardId });
}

export function subscribeComponentCache(listener: () => void): () => void {
  return _cache.subscribe(listener);
}

export function _clearComponentCache(): void {
  _cache.clear();
}
