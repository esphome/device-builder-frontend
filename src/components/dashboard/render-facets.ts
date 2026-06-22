/**
 * Dashboard facet-filter rendering (split out of render-toolbar.ts
 * to keep the facet concern in one place).
 */
import { html, type TemplateResult } from "lit";
import type { Label } from "../../api/types/devices.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";
import { renderFacetSections } from "../filters/facet-sections.js";
import "../filters/filters-popover.js";

/** Facets — one "Filters" trigger + popover of accordion sections,
 *  one per dimension, so the toolbar stays one line regardless of
 *  how many dimensions or selections are active. The labels section
 *  always renders (it is the create path even when the catalog is
 *  empty); area / platform only render when the configured-device
 *  list has at least one usable value to filter by, so a fresh
 *  dashboard with a single-platform fleet doesn't sprout an empty /
 *  single-bucket section that adds no signal.
 *
 *  In YAML-search mode the *labels*, *status*, and *updates*
 *  sections are suppressed — labels are device metadata (not in the
 *  YAML), and online/offline plus update/modified state are runtime
 *  (also not in the YAML), so filtering YAML matches by any of them
 *  is misleading. Area and platform stay because both come from the
 *  YAML itself. The updates section additionally renders only when
 *  the fleet has something to update (no 0/0 noise). */
export function renderFacets(host: ESPHomePageDashboard): TemplateResult {
  const facetSections = renderFacetSections({
    devices: host._devices,
    localize: host._localize,
    selection: {
      selectedLabels: host._selectedLabels,
      selectedAreas: host._selectedAreas,
      selectedPlatforms: host._selectedPlatforms,
      selectedStates: host._selectedStates,
      selectedUpdateStatus: host._selectedUpdateStatus,
    },
    labelUsage: host._computeLabelUsage(),
    yamlMode: host._yamlMode,
    manageLabels: true,
    onChange: (patch) => {
      if (patch.selectedLabels !== undefined) host._selectedLabels = patch.selectedLabels;
      if (patch.selectedAreas !== undefined) host._selectedAreas = patch.selectedAreas;
      if (patch.selectedPlatforms !== undefined)
        host._selectedPlatforms = patch.selectedPlatforms;
      if (patch.selectedStates !== undefined) host._selectedStates = patch.selectedStates;
      if (patch.selectedUpdateStatus !== undefined)
        host._selectedUpdateStatus = patch.selectedUpdateStatus;
    },
    onLabelDelete: (label: Label) => {
      host._openConfirm({ kind: "delete-label", label });
    },
    onLabelEdit: (label: Label) => {
      host._labelDialogEditing = label;
      host._labelDialogOpen = true;
    },
    onLabelCreate: () => {
      host._labelDialogEditing = null;
      host._labelDialogOpen = true;
    },
  });

  // Badge counts facet selections only; a lone search term isn't a menu
  // pill, so it's cleared from the search box's own × instead (#1160).
  return html`
    <div class="filter-group">
      <esphome-filters-popover
        .activeCount=${host._activeFacetCount}
        button-label=${host._localize("dashboard.filter_menu_button")}
        clear-label=${host._localize("dashboard.filter_clear_all")}
        count-label=${host._localize("dashboard.filter_menu_active", {
          count: host._activeFacetCount,
        })}
        @clear-filters=${host._clearAllFilters}
      >
        ${facetSections}
      </esphome-filters-popover>
    </div>
  `;
}
