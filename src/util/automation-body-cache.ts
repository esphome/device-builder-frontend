import type { ESPHomeAPI } from "../api/index.js";
import type {
  AutomationCatalogBody,
  AutomationCatalogBodyType,
} from "../api/types/automations.js";
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
    // Keys are produced by ``_key`` below — by construction the
    // prefix is a valid ``AutomationCatalogBodyType``. The cast
    // keeps the public ``getAutomationBodies`` signature tight
    // (literal union, no bare ``string``).
    const refs = keys.map((key) => {
      const slash = key.indexOf("/");
      return {
        type: key.slice(0, slash) as AutomationCatalogBodyType,
        id: key.slice(slash + 1),
      };
    });
    return api.getAutomationBodies(refs);
  },
});

function _key(type: AutomationCatalogBodyType, id: string): string {
  return `${type}/${id}`;
}

/** Synchronous cache read. ``cacheMisses: false`` on the underlying
 *  store means we never persist a null body, so the return is just
 *  ``AutomationCatalogBody | undefined`` — the ``null`` half of
 *  ``BatchedCache.getCached`` can't surface here. */
export function getCachedAutomationBody(
  type: AutomationCatalogBodyType,
  id: string
): AutomationCatalogBody | undefined {
  return _cache.getCached(_key(type, id), undefined) ?? undefined;
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
