import type { ESPHomeAPI } from "../api/index.js";
import type { AutomationCatalogBody, AutomationCatalogBodyType } from "../api/types.js";
import { BatchedCache } from "./batched-cache.js";

/** Session-scoped cache of full automation bodies, keyed by
 *  ``"<type>/<id>"``. The list endpoints ship slim shapes; the
 *  editor hydrates a body through here when it needs
 *  ``config_entries`` to mount a form. Cross-type fetches in the
 *  same microtask coalesce into one ``automations/get_bodies``
 *  round trip. */

const _cache = new BatchedCache<AutomationCatalogBody, void>({
  name: "automation-body-cache",
  bucketKey: () => "",
  // The list endpoint advertises every (type, id) the editor will
  // ask for; a missing body is a backend contract violation, not a
  // permanent catalog miss. Don't cache the null so a re-mount can
  // recover.
  cacheMisses: false,
  fetch: (api, keys) => {
    const refs = keys.map((key) => {
      const slash = key.indexOf("/");
      return { type: key.slice(0, slash), id: key.slice(slash + 1) };
    });
    return api.getAutomationBodies(refs);
  },
});

function _key(type: AutomationCatalogBodyType, id: string): string {
  return `${type}/${id}`;
}

export function getCachedAutomationBody(
  type: AutomationCatalogBodyType,
  id: string
): AutomationCatalogBody | null | undefined {
  return _cache.getCached(_key(type, id), undefined);
}

export function fetchAutomationBody(
  api: ESPHomeAPI,
  type: AutomationCatalogBodyType,
  id: string
): Promise<AutomationCatalogBody | null> {
  return _cache.fetch(api, _key(type, id), undefined);
}

export function subscribeAutomationBodyCache(listener: () => void): () => void {
  return _cache.subscribe(listener);
}

export function _clearAutomationBodyCache(): void {
  _cache.clear();
}
