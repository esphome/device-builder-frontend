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
import {
  emptyHydrationResult,
  hydrateEntryConfigEntries,
  tallyOutcome,
} from "./automation-body-hydration.js";

/**
 * Session-scoped cache of the five slim automation catalogues
 * (triggers, actions, conditions, light effects, filters), keyed
 * by ``platform|boardId``. After backend #1016 the list endpoints
 * ship slim shapes only; ``light_effects`` and ``filters`` get
 * their ``config_entries`` hydrated below via the shared body
 * cache so ``registry-list`` consumers (which read
 * ``config_entries`` synchronously) keep working. Triggers /
 * actions / conditions don't need hydration here — the navigator
 * only reads picker fields, and the editor hydrates separately
 * via :func:`hydrateAvailableBodies`.
 *
 * ``platform`` / ``boardId`` are part of the cache key because the
 * backend resolves per-platform ``cv.SplitDefault`` fields
 * server-side, so the same catalogue for different platforms has
 * different default values and must cache separately. Concurrent
 * fetches for the same key share one in-flight promise.
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
  const result = emptyHydrationResult();
  const settled = await Promise.allSettled(
    list.map(async (entry) => {
      const outcome = await hydrateEntryConfigEntries(api, type, entry);
      tallyOutcome(result, outcome);
    })
  );
  for (const r of settled) {
    if (r.status === "rejected") {
      result.rejected++;
      console.warn(`${type} hydration failed`, r.reason);
    }
  }
  const failures = result.missingBody + result.missingField + result.rejected;
  if (failures > 0) {
    // Aggregate breadcrumb — per-entry warns already landed via
    // ``hydrateEntryConfigEntries``. Registry-list callers don't
    // own a toast surface; this lets a maintainer triage from one
    // log line without scrolling through per-id noise.
    console.warn(
      `${type} hydration: ${result.succeeded} ok, ${failures} failed ` +
        `(missingBody=${result.missingBody}, missingField=${result.missingField}, rejected=${result.rejected})`
    );
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
