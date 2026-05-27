import type { PropertyValues } from "lit";
import { matchesDeviceName } from "../../util/device-search.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";

export function onSearchKeyDown(host: ESPHomePageDashboard, e: KeyboardEvent): void {
  if (e.key === "Escape" && host._yamlMode) {
    e.preventDefault();
    setSearchMode(host, false, "");
    return;
  }
  if (e.key !== "/") return;
  if (host._yamlMode) return;
  if (host._search !== "") return;
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  e.preventDefault();
  setSearchMode(host, true);
}

export function refocusSearchInput(host: ESPHomePageDashboard): void {
  requestAnimationFrame(() => {
    const wrap = host._searchInputEl;
    if (!wrap) return;
    wrap.focus();
    const inner = (
      wrap as HTMLElement & { shadowRoot?: ShadowRoot | null }
    ).shadowRoot?.querySelector<HTMLInputElement>("input");
    inner?.focus();
  });
}

export function syncYamlSearch(host: ESPHomePageDashboard): void {
  if (!host._yamlMode) {
    host._yamlSearch.clear();
    return;
  }
  const body = host._search.trim();
  if (!body) {
    host._yamlSearch.clear();
    return;
  }
  host._yamlSearch.scheduleQuery(body);
}

export function setSearchMode(
  host: ESPHomePageDashboard,
  yamlMode: boolean,
  search?: string
): void {
  host._yamlMode = yamlMode;
  if (search !== undefined) host._search = search;
  syncYamlSearch(host);
  refocusSearchInput(host);
}

// When the user's name query matches no devices, pre-fire a YAML search so
// the empty state can show "Try YAML — N matches" with a real count.
export function maybeFireEmptyStatePreview(
  host: ESPHomePageDashboard,
  changed: PropertyValues
): void {
  if (!changed.has("_search") && !changed.has("_yamlMode")) return;
  if (!host._isDeviceSearchActive) return;
  const trimmed = host._search.trim();
  if (!trimmed) {
    host._yamlSearch.clear();
    return;
  }
  const lowered = trimmed.toLowerCase();
  const anyDeviceMatches = host._sortedDevices.some((d) => matchesDeviceName(d, lowered));
  if (anyDeviceMatches) {
    host._yamlSearch.clear();
    return;
  }
  host._yamlSearch.scheduleQuery(trimmed);
}
