import type { ESPHomeAPI } from "../api/index.js";

/** Ids of the components that provide an interface, board-scoped and cached
 *  for the process lifetime. The backend catalog is immutable for that
 *  lifetime (see `component-name-cache`), so the same `provides` query never
 *  needs to re-run. A rejected lookup is evicted so a later call retries. */
const _cache = new Map<string, Promise<ReadonlySet<string>>>();

/** Ids of components that provide `interfaceName` on this platform/board. */
export function providerIds(
  api: ESPHomeAPI,
  interfaceName: string,
  platform?: string,
  boardId?: string
): Promise<ReadonlySet<string>> {
  const key = `${interfaceName}|${platform ?? ""}|${boardId ?? ""}`;
  let pending = _cache.get(key);
  if (!pending) {
    pending = api
      .getComponents({
        provides: interfaceName,
        platform: platform ?? undefined,
        board_id: boardId ?? undefined,
        // One page holds every provider; an interface has at most a handful,
        // so this never truncates (mirrors config-entry-form's provider fetch).
        limit: 200,
      })
      .then((resp): ReadonlySet<string> => new Set(resp.components.map((c) => c.id)))
      .catch((err) => {
        _cache.delete(key);
        throw err;
      });
    _cache.set(key, pending);
  }
  return pending;
}

export function _clearProvidesCache(): void {
  _cache.clear();
}
