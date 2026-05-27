import type { ESPHomeAPI } from "../api/index.js";
import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
  LightEffect,
} from "../api/types.js";

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

type CatalogKind = "triggers" | "actions" | "conditions" | "light_effects";

type CatalogValue = {
  triggers: AutomationTrigger[];
  actions: AutomationAction[];
  conditions: AutomationCondition[];
  light_effects: LightEffect[];
};

const _cache: {
  [K in CatalogKind]: Map<string, CatalogValue[K]>;
} = {
  triggers: new Map(),
  actions: new Map(),
  conditions: new Map(),
  light_effects: new Map(),
};

const _inflight: {
  [K in CatalogKind]: Map<string, Promise<CatalogValue[K]>>;
} = {
  triggers: new Map(),
  actions: new Map(),
  conditions: new Map(),
  light_effects: new Map(),
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
  return _fetch("light_effects", (p, b) => api.getLightEffects(p, b), platform, boardId);
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
  for (const kind of ["triggers", "actions", "conditions", "light_effects"] as const) {
    _cache[kind].clear();
    _inflight[kind].clear();
  }
  _listeners.clear();
}
