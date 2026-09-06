import type { ESPHomeAPI } from "../api/index.js";
import {
  catalogEntryToProvider,
  type ComponentProvider,
} from "./config-entry-yaml-scan.js";
import { fetchAllComponents } from "./fetch-all-components.js";
import { KeyedPromiseCache } from "./keyed-promise-cache.js";
import { createSessionBlobCache } from "./session-blob-cache.js";

/** Ids of the components that provide an interface, board-scoped and cached
 *  for the process lifetime. The backend catalog is immutable for that
 *  lifetime (see `component-name-cache`), so the same `provides` query never
 *  needs to re-run. A rejected lookup is evicted so a later call retries. */
const _cache = new KeyedPromiseCache<ReadonlySet<string>>();

/** Ids of components that provide `interfaceName` on this platform/board. */
export function providerIds(
  api: ESPHomeAPI,
  interfaceName: string,
  platform?: string,
  boardId?: string
): Promise<ReadonlySet<string>> {
  const key = `${interfaceName}|${platform ?? ""}|${boardId ?? ""}`;
  return _cache.fetch(key, () =>
    fetchAllComponents(api, {
      provides: interfaceName,
      platform: platform ?? undefined,
      board_id: boardId ?? undefined,
    }).then((components): ReadonlySet<string> => new Set(components.map((c) => c.id)))
  );
}

export function _clearProvidesCache(): void {
  _cache.clear();
  _providers.reset();
}

/** Providers of an interface, shared by every form for the session.
 *  Board-agnostic on purpose: the id-reference candidates come from the
 *  YAML, unlike the board-scoped ``providerIds`` above. */
const _providers = createSessionBlobCache<readonly ComponentProvider[], [string]>({
  name: "interface-providers",
  key: (interfaceName) => interfaceName,
  fetch: (api, interfaceName) =>
    fetchAllComponents(api, { provides: interfaceName })
      .then((components) =>
        components.map((c) => catalogEntryToProvider(c, interfaceName))
      )
      .catch((err: unknown) => {
        // Warn (not debug) so the dropped-candidate path is observable.
        console.warn("[provides-cache] provider fetch failed for", interfaceName, err);
        throw err;
      }),
});

/** Resolved providers of `interfaceName`, or `undefined` until fetched. */
export function getCachedInterfaceProviders(
  interfaceName: string
): readonly ComponentProvider[] | undefined {
  return _providers.getCached(interfaceName);
}

/** Subscribe to provider cache population; returns an unsubscribe function. */
export function subscribeInterfaceProviders(cb: () => void): () => void {
  return _providers.subscribe(cb);
}

/** Fetch the providers of `interfaceName` once; concurrent callers share it. */
export function fetchInterfaceProviders(
  api: ESPHomeAPI,
  interfaceName: string
): Promise<readonly ComponentProvider[]> {
  return _providers.fetch(api, interfaceName);
}
