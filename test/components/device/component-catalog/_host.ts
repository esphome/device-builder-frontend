/**
 * Shared catalog-host fake for the pure card render functions
 * (renderCard / renderBundleCard). Carries every host member the
 * renderers read, so a new member lands here once instead of in each
 * suite's hand-rolled copy.
 */
import type { ESPHomeComponentCatalog } from "../../../../src/components/device/component-catalog.js";
import { identityLocalize } from "../../../_dom.js";

export function makeCatalogHost(
  overrides: Record<string, unknown> = {}
): ESPHomeComponentCatalog {
  return {
    _imageFailed: new Set<string>(),
    _overflowingDescriptions: new Set<string>(),
    _expandedId: null,
    _category: "all",
    board: null,
    _localize: identityLocalize,
    _onAdd: () => {},
    _onAddBundle: () => {},
    _onToggleExpand: () => {},
    _onImageError: () => {},
    ...overrides,
  } as unknown as ESPHomeComponentCatalog;
}
