import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";
import { identityLocalize } from "../../_dom.js";

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
