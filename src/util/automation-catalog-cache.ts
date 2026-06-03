import type { ESPHomeAPI } from "../api/index.js";
import type {
  AutomationAction,
  AutomationCatalogBodyType,
  AutomationCondition,
  AutomationTrigger,
  Filter,
  LightEffect,
  RegistryCatalogEntry,
} from "../api/types/automations.js";
import {
  emptyHydrationResult,
  hydrateEntryConfigEntries,
  tallyOutcome,
  type HydrationResult,
} from "./automation-body-hydration.js";
import { createSessionBlobCache, type SessionBlobCache } from "./session-blob-cache.js";

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

function _key(platform?: string, boardId?: string): string {
  return `${platform ?? ""}|${boardId ?? ""}`;
}

// One session-blob cache per catalogue kind, all keyed by
// ``platform|boardId``. No ``fallback`` — a failed list fetch rethrows
// and isn't cached, so the next call retries; ``light_effects`` /
// ``filters`` add a hydration pass below via each cache's ``update``.
const _caches: {
  [K in CatalogKind]: SessionBlobCache<CatalogValue[K], [string?, string?]>;
} = {
  triggers: createSessionBlobCache<AutomationTrigger[], [string?, string?]>({
    name: "automation-catalog-cache:triggers",
    key: _key,
    fetch: (api, p, b) => api.getAutomationTriggers(p, b),
  }),
  actions: createSessionBlobCache<AutomationAction[], [string?, string?]>({
    name: "automation-catalog-cache:actions",
    key: _key,
    fetch: (api, p, b) => api.getAutomationActions(p, b),
  }),
  conditions: createSessionBlobCache<AutomationCondition[], [string?, string?]>({
    name: "automation-catalog-cache:conditions",
    key: _key,
    fetch: (api, p, b) => api.getAutomationConditions(p, b),
  }),
  light_effects: createSessionBlobCache<LightEffect[], [string?, string?]>({
    name: "automation-catalog-cache:light_effects",
    key: _key,
    fetch: (api, p, b) => api.getLightEffects(p, b),
  }),
  filters: createSessionBlobCache<Filter[], [string?, string?]>({
    name: "automation-catalog-cache:filters",
    key: _key,
    fetch: (api, p, b) => api.getFilters(p, b),
  }),
};

export function getCachedAutomationTriggers(
  platform?: string,
  boardId?: string
): AutomationTrigger[] | undefined {
  return _caches.triggers.getCached(platform, boardId);
}

export function fetchAutomationTriggers(
  api: ESPHomeAPI,
  platform?: string,
  boardId?: string
): Promise<AutomationTrigger[]> {
  return _caches.triggers.fetch(api, platform, boardId);
}

export function getCachedAutomationActions(
  platform?: string,
  boardId?: string
): AutomationAction[] | undefined {
  return _caches.actions.getCached(platform, boardId);
}

export function fetchAutomationActions(
  api: ESPHomeAPI,
  platform?: string,
  boardId?: string
): Promise<AutomationAction[]> {
  return _caches.actions.fetch(api, platform, boardId);
}

export function getCachedAutomationConditions(
  platform?: string,
  boardId?: string
): AutomationCondition[] | undefined {
  return _caches.conditions.getCached(platform, boardId);
}

export function fetchAutomationConditions(
  api: ESPHomeAPI,
  platform?: string,
  boardId?: string
): Promise<AutomationCondition[]> {
  return _caches.conditions.fetch(api, platform, boardId);
}

export function getCachedLightEffects(
  platform?: string,
  boardId?: string
): LightEffect[] | undefined {
  return _caches.light_effects.getCached(platform, boardId);
}

export async function fetchLightEffects(
  api: ESPHomeAPI,
  platform?: string,
  boardId?: string
): Promise<LightEffect[]> {
  const list = await _caches.light_effects.fetch(api, platform, boardId);
  // Hydration runs OUTSIDE the cache fetch so cache hits also retry
  // any entries whose body fetch previously failed —
  // ``_hydratedEntries`` short-circuits already-done ones, so the
  // happy path pays a no-op filter.
  return _postHydrate("light_effects", platform, boardId, list, (l) =>
    _hydrateRegistryConfigEntries(api, "light_effects", l)
  );
}

export function getCachedFilters(
  platform?: string,
  boardId?: string
): Filter[] | undefined {
  return _caches.filters.getCached(platform, boardId);
}

export async function fetchFilters(
  api: ESPHomeAPI,
  platform?: string,
  boardId?: string
): Promise<Filter[]> {
  const list = await _caches.filters.fetch(api, platform, boardId);
  return _postHydrate("filters", platform, boardId, list, (l) =>
    _hydrateRegistryConfigEntries(api, "filters", l)
  );
}

/** After the cache fetch notifies subscribers with the slim list,
 *  hydrate ``config_entries`` and — if any entry actually changed —
 *  ``update`` the cache with a fresh array identity (which notifies
 *  again) so identity-checking consumers (registry-list's
 *  ``subscribeAutomationCatalogCache`` reread of ``cache()``) repaint
 *  with the hydrated entries. Without the second notify + identity
 *  swap, the slim entries the first notify painted would never
 *  refresh: in-place mutation of ``config_entries`` doesn't bump the
 *  array reference Lit's ``hasChanged`` compares against. */
async function _postHydrate<K extends "light_effects" | "filters">(
  kind: K,
  platform: string | undefined,
  boardId: string | undefined,
  list: CatalogValue[K],
  hydrate: (list: CatalogValue[K]) => Promise<HydrationResult>
): Promise<CatalogValue[K]> {
  const result = await hydrate(list);
  if (result.succeeded === 0) return list;
  const fresh = [...list] as CatalogValue[K];
  _caches[kind].update(fresh, platform, boardId);
  return fresh;
}

/** Per-entry hydration flag. Membership = body landed and
 *  ``config_entries`` is the full schema; absence = either never
 *  attempted or the previous attempt failed (null body / shapeless
 *  body / rejection). Kept as a ``WeakSet`` so entries removed from
 *  the catalog (e.g. via ``_clearAutomationCatalogCache``) GC
 *  cleanly without us tracking removals separately. */
const _hydratedEntries = new WeakSet<RegistryCatalogEntry>();

/** Populate ``config_entries`` on un-hydrated entries via the body
 *  cache. After backend #1016, the ``get_light_effects`` /
 *  ``get_filters`` endpoints ship slim shapes; ``registry-list``
 *  reads ``config_entries`` off cached entries. Filters to entries
 *  not yet in ``_hydratedEntries`` so the happy-path retry is a
 *  no-op walk — only entries whose previous attempt failed hit the
 *  network, and the body cache coalesces those into one
 *  ``get_bodies`` round trip.
 *
 *  Concurrency: the ``_hydratedEntries`` filter is best-effort
 *  dedup — two concurrent ``fetchLightEffects`` calls that race
 *  past the filter will both walk the same entries and both run
 *  ``structuredClone`` + reassign. The body cache's in-flight
 *  promise dedup is the real network-concurrency guard; the
 *  WeakSet just keeps subsequent calls fast. Idempotent: last
 *  write wins with identical data. */
async function _hydrateRegistryConfigEntries(
  api: ESPHomeAPI,
  type: AutomationCatalogBodyType,
  list: RegistryCatalogEntry[]
): Promise<HydrationResult> {
  const result = emptyHydrationResult();
  const targets = list.filter((e) => !_hydratedEntries.has(e));
  if (targets.length === 0) return result;
  const settled = await Promise.allSettled(
    targets.map(async (entry) => {
      const outcome = await hydrateEntryConfigEntries(api, type, entry);
      if (outcome === "ok") _hydratedEntries.add(entry);
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
    // log line without scrolling through per-id noise. Subsequent
    // ``fetchLightEffects`` / ``fetchFilters`` calls (e.g. a
    // form re-mount) retry the un-flagged entries.
    console.warn(
      `${type} hydration: ${result.succeeded} ok, ${failures} failed ` +
        `(missingBody=${result.missingBody}, missingField=${result.missingField}, rejected=${result.rejected})`
    );
  }
  return result;
}

/** Subscribe to cache updates. Returns an unsubscribe function.
 *  Listeners fire once per fresh entry (across any of the five
 *  catalogues); failed fetches do not fire. Fanned across every
 *  per-kind cache so one subscription covers them all. */
export function subscribeAutomationCatalogCache(listener: () => void): () => void {
  const unsubs = Object.values(_caches).map((c) => c.subscribe(listener));
  return () => {
    for (const unsub of unsubs) unsub();
  };
}

/** Test-only: drop all cached entries, pending promises, and listeners. */
export function _clearAutomationCatalogCache(): void {
  for (const cache of Object.values(_caches)) cache.reset();
}
