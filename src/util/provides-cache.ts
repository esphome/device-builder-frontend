import type { ESPHomeAPI } from "../api/index.js";
import { fetchAllComponents } from "./fetch-all-components.js";
import { KeyedPromiseCache } from "./keyed-promise-cache.js";

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
}
