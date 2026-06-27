/**
 * Session-scoped seed for the dashboard's filter facets so they survive
 * in-app page switches (open a device, come back via the home/command-palette
 * path) and tab reloads, then reset when the browser/tab closes. The URL query
 * string stays the authoritative, shareable layer (see dashboard-url.ts); this
 * only seeds facets the URL doesn't carry. Search text and view mode are out of
 * scope. Storage access is guarded so a throw (private mode / sandboxed iframe /
 * quota) falls back to no seed instead of breaking the dashboard.
 *
 * Labels are stored as ids (not names like the URL): same-session, ids are
 * stable, so the seed path skips the name-resolution dance entirely.
 */

export const STORAGE_KEY = "esphome-dashboard-filters";

export interface DashboardFilterState {
  labels: string[];
  areas: string[];
  platforms: string[];
  states: string[];
  updates: string[];
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

/** Read the saved facet selection, or null if absent / unparseable. A
 *  malformed individual facet falls back to an empty array. */
export function loadDashboardFilters(): DashboardFilterState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const obj = parsed as Record<string, unknown>;
    return {
      labels: isStringArray(obj.labels) ? obj.labels : [],
      areas: isStringArray(obj.areas) ? obj.areas : [],
      platforms: isStringArray(obj.platforms) ? obj.platforms : [],
      states: isStringArray(obj.states) ? obj.states : [],
      updates: isStringArray(obj.updates) ? obj.updates : [],
    };
  } catch {
    return null;
  }
}

/** Persist the facet selection; drops the write if storage is unavailable. */
export function saveDashboardFilters(state: DashboardFilterState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Drop the write so filtering still completes.
  }
}
