import { identityLocalize } from "../../_dom.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";

/**
 * Overrides-based stub for helpers that take the dashboard page as host.
 *
 * Common dashboard-host fields get inert defaults; pass surface-specific
 * state, spies, and the ``_api`` method subset through ``overrides``.
 */
export function makeDashboardHost(
  overrides: Record<string, unknown> = {}
): ESPHomePageDashboard {
  return {
    _localize: identityLocalize,
    _yamlMode: false,
    _search: "",
    ...overrides,
  } as unknown as ESPHomePageDashboard;
}

/**
 * ``makeDashboardHost`` plus the inert baseline ``renderTable`` requires
 * (table prefs, selection, facet stubs). Pass devices and test-specific
 * state through ``overrides``.
 */
export function makeTableHost(
  overrides: Record<string, unknown> = {}
): ESPHomePageDashboard {
  return makeDashboardHost({
    _devices: [],
    _sortedDevices: [],
    _applyFacetFilters: (list: ConfiguredDevice[]) => list,
    _activeJobs: new Map(),
    _recentJobs: new Map(),
    _tablePageSize: 25,
    _tableSorting: [],
    _tableColumnVisibility: {},
    _selectMode: false,
    _visibleImportableDevices: [],
    _selectedDevices: new Set<string>(),
    _recentlyAdopted: null,
    _expertMode: false,
    _selectedLabels: [],
    _selectedAreas: [],
    _selectedPlatforms: [],
    _selectedStates: [],
    _selectedUpdateStatus: [],
    _activeFacetCount: 0,
    _computeLabelUsage: () => new Map(),
    _allVisibleSelected: false,
    ...overrides,
  });
}
