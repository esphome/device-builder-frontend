/**
 * Pure device-list filtering for the dashboard's faceted toolbar.
 *
 * The dashboard renders the configured-device list through a fixed
 * pipeline: facet narrowing (labels / area / platform / state /
 * update-status) followed by a free-text name search. Lifting that
 * pipeline out of the component keeps the rules testable over plain
 * arrays — no Lit element, no ``window``, no DOM — and gives the
 * "are any filters active?" / "how many facet pills are lit?"
 * questions a single source of truth shared by the render path, the
 * empty-state pivot, and the toolbar badge.
 *
 * The component keeps thin wrappers (and its ``memoize-one`` caches)
 * around these helpers; the semantics live here.
 */

import type { ConfiguredDevice } from "../api/types/devices.js";
import { matchesDeviceName, matchesMacAddress } from "./device-search.js";
import { UPDATE_FACET_BUCKETS, UPDATE_FACET_PREDICATES } from "./facets.js";

/** The five facet selections the toolbar tracks. Each is the list
 *  of currently-checked option ids for that facet (empty = facet
 *  not narrowing). */
export interface FacetSelection {
  selectedLabels: string[];
  selectedAreas: string[];
  selectedPlatforms: string[];
  selectedStates: string[];
  selectedUpdateStatus: string[];
}

/**
 * Apply every active facet filter to *devices*.
 *
 * Labels and update-status use AND semantics (a device must carry
 * every selected label / satisfy every selected update bucket — the
 * "drill down by tag stack" shape); area, platform, and state use OR
 * within the facet and AND across facets, the conventional faceted-
 * search shape. An empty selection array leaves that facet inactive.
 */
export function applyFacetFilters(
  devices: ConfiguredDevice[],
  selection: FacetSelection
): ConfiguredDevice[] {
  const {
    selectedLabels,
    selectedAreas,
    selectedPlatforms,
    selectedStates,
    selectedUpdateStatus,
  } = selection;

  let out = devices;
  if (selectedLabels.length > 0) {
    out = out.filter((d) => {
      const ids = d.labels;
      if (!ids || ids.length === 0) return false;
      const set = new Set(ids);
      return selectedLabels.every((id) => set.has(id));
    });
  }
  if (selectedAreas.length > 0) {
    const set = new Set(selectedAreas);
    out = out.filter((d) => !!d.area && set.has(d.area));
  }
  if (selectedPlatforms.length > 0) {
    const set = new Set(selectedPlatforms);
    out = out.filter((d) => set.has(d.target_platform));
  }
  if (selectedStates.length > 0) {
    const set = new Set(selectedStates);
    out = out.filter((d) => set.has(d.state));
  }
  if (selectedUpdateStatus.length > 0) {
    // AND / narrowing: a device must satisfy every selected bucket
    // (mirrors the labels facet, not the OR facets above).
    const set = new Set(selectedUpdateStatus);
    out = out.filter((d) =>
      UPDATE_FACET_BUCKETS.every((id) => !set.has(id) || UPDATE_FACET_PREDICATES[id](d))
    );
  }
  return out;
}

/** True when any facet or the text search would currently narrow the
 *  device list — drives the empty-state "no devices match" pivot and
 *  the toolbar's clear-button messaging. */
export function hasActiveFilters(search: string, selection: FacetSelection): boolean {
  return search.trim().length > 0 || activeFacetCount(selection) > 0;
}

/** Count of lit facet pills — facets only, so a lone text search
 *  (cleared from the search box's own ×) doesn't inflate the
 *  Filters-button badge. */
export function activeFacetCount(selection: FacetSelection): number {
  return (
    selection.selectedLabels.length +
    selection.selectedAreas.length +
    selection.selectedPlatforms.length +
    selection.selectedStates.length +
    selection.selectedUpdateStatus.length
  );
}

/**
 * True when *device* matches the lowered free-text *query*.
 *
 * Card view matches on name only; table view also matches address /
 * IP / platform / MAC so "Select all" tracks the table's global
 * filter. *query* must already be lower-cased (matching
 * ``matchesDeviceName``); the MAC predicate is shared with the table
 * so the two can't drift.
 */
export function matchesDeviceSearch(
  device: ConfiguredDevice,
  query: string,
  includeAddressFields: boolean
): boolean {
  if (matchesDeviceName(device, query)) return true;
  if (!includeAddressFields) return false;
  return (
    device.address.toLowerCase().includes(query) ||
    device.ip_addresses.some((ip) => ip.toLowerCase().includes(query)) ||
    device.target_platform.toLowerCase().includes(query) ||
    matchesMacAddress(device.mac_address, query)
  );
}
