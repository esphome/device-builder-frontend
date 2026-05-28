import type { ESPHomeAPI } from "../api/index.js";
import type { ComponentCatalogEntry } from "../api/types.js";
import { BatchedCache } from "./batched-cache.js";

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
  fetch: (api, ids, { platform, boardId }) =>
    api.getComponentBodies(ids, platform, boardId),
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
