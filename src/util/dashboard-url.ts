/**
 * Serialize / restore the dashboard's filter + search state via the
 * URL query string so a refresh, deep-link share, or browser-back
 * lands the user on exactly the same filtered view.
 *
 * Round-trip shape (compact param names — keeps the bar readable):
 *
 *  - ``q``         — free-text search string
 *  - ``labels``    — comma-separated label *names* (AND semantics);
 *                    names instead of ids so a shared URL stays
 *                    readable and stable across catalog reshuffles
 *  - ``areas``     — comma-separated area names
 *  - ``platforms`` — comma-separated target_platform values
 *  - ``states``    — comma-separated DeviceState values
 *  - ``view``      — ``table`` (omitted for the cards default)
 *  - ``yaml``      — ``1`` (omitted for the device-search default)
 *
 * Defaults (empty arrays, cards view, no yaml mode, empty search)
 * are *not* serialized so a pristine dashboard renders a clean URL.
 * On read the helper returns ``undefined`` for any missing param
 * so callers can apply their own defaults — partial URLs (a
 * shared link that only sets ``labels``) work without forcing the
 * caller to know about every key.
 *
 * Writes go through ``history.replaceState`` so toggling filters
 * doesn't pollute the back stack with intermediate snapshots —
 * the user's Back button still leaves the dashboard cleanly.
 */

import { DashboardView } from "../api/types.js";

export interface DashboardUrlState {
  search?: string;
  labels?: string[];
  areas?: string[];
  platforms?: string[];
  states?: string[];
  view?: DashboardView;
  yaml?: boolean;
}

function fromCsv(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  const out = raw
    .split(",")
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        // Malformed percent-encoding (URL hand-edited or copied
        // through a buggy share sheet) — drop the bad fragment
        // rather than throwing into the dashboard render.
        return "";
      }
    })
    .filter((s) => s.length > 0);
  return out.length > 0 ? out : undefined;
}

function toCsv(arr: readonly string[] | undefined): string | undefined {
  if (!arr || arr.length === 0) return undefined;
  return arr.map((s) => encodeURIComponent(s)).join(",");
}

export function readDashboardUrl(): DashboardUrlState {
  const p = new URLSearchParams(window.location.search);
  const search = p.get("q") ?? undefined;
  const view = p.get("view") === "table" ? DashboardView.TABLE : undefined;
  return {
    search: search && search.length > 0 ? search : undefined,
    labels: fromCsv(p.get("labels")),
    areas: fromCsv(p.get("areas")),
    platforms: fromCsv(p.get("platforms")),
    states: fromCsv(p.get("states")),
    view,
    yaml: p.get("yaml") === "1" ? true : undefined,
  };
}

export function writeDashboardUrl(state: DashboardUrlState): void {
  const url = new URL(window.location.href);
  const set = (key: string, value: string | undefined): void => {
    if (value === undefined || value === "") url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  };
  set("q", state.search && state.search.length > 0 ? state.search : undefined);
  set("labels", toCsv(state.labels));
  set("areas", toCsv(state.areas));
  set("platforms", toCsv(state.platforms));
  set("states", toCsv(state.states));
  set("view", state.view === DashboardView.TABLE ? "table" : undefined);
  set("yaml", state.yaml ? "1" : undefined);
  // ``replaceState`` keeps the back button clean — we don't want a
  // separate history entry every time the user toggles a chip.
  const next = url.pathname + (url.search ? url.search : "") + url.hash;
  history.replaceState(history.state, "", next);
}
