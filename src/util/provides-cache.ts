import type { ESPHomeAPI } from "../api/index.js";
import { KeyedPromiseCache } from "./keyed-promise-cache.js";

/** Page size for the fetch-all `getComponents({provides})` sites. Sized so a
 *  single page covers every known interface today (same-domain sub-entity
 *  providers put `sensor` near 200); a larger catalog would truncate
 *  silently until the callers page on `resp.total` (#1152). */
export const PROVIDER_FETCH_LIMIT = 500;

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
    api
      .getComponents({
        provides: interfaceName,
        platform: platform ?? undefined,
        board_id: boardId ?? undefined,
        limit: PROVIDER_FETCH_LIMIT,
      })
      .then((resp): ReadonlySet<string> => new Set(resp.components.map((c) => c.id)))
  );
}

export function _clearProvidesCache(): void {
  _cache.clear();
}
