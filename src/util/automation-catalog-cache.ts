import type { ESPHomeAPI } from "../api/index.js";
import type {
  AutomationAction,
  AutomationCatalogBodyType,
  AutomationCondition,
  AutomationTrigger,
  Filter,
  LightEffect,
  RegistryCatalogEntry,
} from "../api/types.js";
import { fetchAutomationBody } from "./automation-body-cache.js";

/**
 * Session-scoped cache of the four automation catalogues —
 * triggers, actions, conditions, light effects — keyed by
 * ``platform|boardId``.
 *
 * Each catalogue is loaded from a static JSON file on the backend
 * (``definitions/automations.json``, baked at release time) and is
 * immutable for the lifetime of the process, so cached lists never
 * need invalidation. ``platform`` / ``boardId`` participate in the
 * key because the backend resolves per-platform
 * ``cv.SplitDefault`` fields on trigger/action parameter schemas
 * server-side — the same list filtered for a different platform
 * has different default values and must be cached separately.
 *
 * Concurrent fetches for the same key share a single in-flight
 * promise (the automation editor mount typically issues all four
 * commands in parallel; nothing prevents two mounts from racing).
 *
 * Mirrors ``component-name-cache.ts``; the duplication is
 * deliberate — each cache has its own value shape and fetcher, and
 * a generic helper would obscure the call sites without saving any
 * meaningful code.
 */

type CatalogKind = "triggers" | "actions" | "conditions" | "light_effects" | "filters";

type CatalogValue = {
  triggers: AutomationTrigger[];
  actions: AutomationAction[];
  conditions: AutomationCondition[];
  light_effects: LightEffect[];
  filters: Filter[];
};

const _cache: {
  [K in CatalogKind]: Map<string, CatalogValue[K]>;
} = {
  triggers: new Map(),
  actions: new Map(),
  conditions: new Map(),
  light_effects: new Map(),
  filters: new Map(),
};

const _inflight: {
  [K in CatalogKind]: Map<string, Promise<CatalogValue[K]>>;
} = {
  triggers: new Map(),
  actions: new Map(),
  conditions: new Map(),
  light_effects: new Map(),
  filters: new Map(),
};

const _listeners = new Set<() => void>();

function _key(platform?: string, boardId?: string): string {
  return `${platform ?? ""}|${boardId ?? ""}`;
}

function _notify(): void {
  // Isolate each listener so a throwing subscriber doesn't reject
  // the fetch promise (the cache is already populated at this
  // point, so the rejection would be misleading) or skip later
  // listeners. Same isolation as ``component-name-cache.ts``.
  for (const listener of _listeners) {
    try {
      listener();
    } catch (err) {
      console.error("automation-catalog-cache listener threw", err);
    }
  }
}

function _fetch<K extends CatalogKind>(
  kind: K,
  fetcher: (platform?: string, boardId?: string) => Promise<CatalogValue[K]>,
  platform: string | undefined,
  boardId: string | undefined
): Promise<CatalogValue[K]> {
  const key = _key(platform, boardId);
  const cached = _cache[kind].get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  const existing = _inflight[kind].get(key);
  if (existing) return existing;

  const promise = fetcher(platform, boardId)
    .then((entries) => {
      _cache[kind].set(key, entries);
      _inflight[kind].delete(key);
      _notify();
      return entries;
    })
    .catch((err) => {
      _inflight[kind].delete(key);
      throw err;
    });

  _inflight[kind].set(key, promise);
  return promise;
}

export function getCachedAutomationTriggers(
  platform?: string,
  boardId?: string
): AutomationTrigger[] | undefined {
  return _cache.triggers.get(_key(platform, boardId));
}

export function fetchAutomationTriggers(
  api: ESPHomeAPI,
  platform?: string,
  boardId?: string
): Promise<AutomationTrigger[]> {
  return _fetch("triggers", (p, b) => api.getAutomationTriggers(p, b), platform, boardId);
}

export function getCachedAutomationActions(
  platform?: string,
  boardId?: string
): AutomationAction[] | undefined {
  return _cache.actions.get(_key(platform, boardId));
}

export function fetchAutomationActions(
  api: ESPHomeAPI,
  platform?: string,
  boardId?: string
): Promise<AutomationAction[]> {
  return _fetch("actions", (p, b) => api.getAutomationActions(p, b), platform, boardId);
}

export function getCachedAutomationConditions(
  platform?: string,
  boardId?: string
): AutomationCondition[] | undefined {
  return _cache.conditions.get(_key(platform, boardId));
}

export function fetchAutomationConditions(
  api: ESPHomeAPI,
  platform?: string,
  boardId?: string
): Promise<AutomationCondition[]> {
  return _fetch(
    "conditions",
    (p, b) => api.getAutomationConditions(p, b),
    platform,
    boardId
  );
}

export function getCachedLightEffects(
  platform?: string,
  boardId?: string
): LightEffect[] | undefined {
  return _cache.light_effects.get(_key(platform, boardId));
}

export function fetchLightEffects(
  api: ESPHomeAPI,
  platform?: string,
  boardId?: string
): Promise<LightEffect[]> {
  return _fetch(
    "light_effects",
    async (p, b) => {
      const list = await api.getLightEffects(p, b);
      await _hydrateRegistryConfigEntries(api, "light_effects", list);
      return list;
    },
    platform,
    boardId
  );
}

export function getCachedFilters(
  platform?: string,
  boardId?: string
): Filter[] | undefined {
  return _cache.filters.get(_key(platform, boardId));
}

export function fetchFilters(
  api: ESPHomeAPI,
  platform?: string,
  boardId?: string
): Promise<Filter[]> {
  return _fetch(
    "filters",
    async (p, b) => {
      const list = await api.getFilters(p, b);
      await _hydrateRegistryConfigEntries(api, "filters", list);
      return list;
    },
    platform,
    boardId
  );
}

/** Populate ``config_entries`` on each entry by routing through the
 *  body cache. After backend #1016, ``automations/get_light_effects``
 *  and ``automations/get_filters`` ship slim shapes (no
 *  ``config_entries``); ``registry-list`` reads ``config_entries``
 *  off cached entries, so the list has to land already hydrated. The
 *  body cache coalesces the fan-out into one ``get_bodies`` round
 *  trip. */
async function _hydrateRegistryConfigEntries(
  api: ESPHomeAPI,
  type: AutomationCatalogBodyType,
  list: RegistryCatalogEntry[]
): Promise<void> {
  const results = await Promise.allSettled(
    list.map(async (entry) => {
      const body = await fetchAutomationBody(api, type, entry.id);
      if (body && "config_entries" in body) {
        entry.config_entries = [...body.config_entries];
      }
    })
  );
  for (const r of results) {
    if (r.status === "rejected") {
      console.warn(`${type} hydration failed`, r.reason);
    }
  }
}

/** Subscribe to cache updates. Returns an unsubscribe function.
 *  Listeners fire once per fresh entry (across any of the four
 *  catalogues); failed fetches do not fire. */
export function subscribeAutomationCatalogCache(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}

/** Test-only: drop all cached entries and pending promises. */
export function _clearAutomationCatalogCache(): void {
  // Derive the kinds from `_cache` so new registries (filters,
  // ...) don't have to remember to update this list separately.
  for (const kind of Object.keys(_cache) as CatalogKind[]) {
    _cache[kind].clear();
    _inflight[kind].clear();
  }
  _listeners.clear();
}
