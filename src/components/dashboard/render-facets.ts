/**
 * Dashboard facet-filter rendering (split out of render-toolbar.ts
 * to keep the facet concern in one place).
 */
import { html, nothing, type TemplateResult } from "lit";
import type { Label } from "../../api/types/devices.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";
import {
  computeAreaFacet,
  computePlatformFacet,
  computeStateFacet,
  computeUpdateFacet,
} from "../../util/facets.js";
import "../filters/filter-section.js";
import "../filters/filters-popover.js";
import "../filters/labels-filter-section.js";

export function renderLabelsFilter(host: ESPHomePageDashboard): TemplateResult {
  // Labels keeps its own section component because its rows carry
  // colour chips and the rename / delete / create affordances that
  // the generic ``<esphome-filter-section>`` doesn't expose.
  return html`<esphome-labels-filter-section
    .selected=${host._selectedLabels}
    .usageCounts=${host._computeLabelUsage()}
    @labels-filter-change=${(e: CustomEvent<string[]>) => {
      host._selectedLabels = e.detail;
    }}
    @request-delete-label=${(e: CustomEvent<Label>) => {
      host._openConfirm({ kind: "delete-label", label: e.detail });
    }}
    @request-edit-label=${(e: CustomEvent<Label>) => {
      host._labelDialogEditing = e.detail;
      host._labelDialogOpen = true;
    }}
    @request-create-label=${() => {
      host._labelDialogEditing = null;
      host._labelDialogOpen = true;
    }}
  ></esphome-labels-filter-section>`;
}

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
  const areaOptions = computeAreaFacet(host._devices);
  const platformOptions = computePlatformFacet(host._devices);
  const stateOptions = computeStateFacet(host._devices, host._localize);
  const updateOptions = computeUpdateFacet(
    host._devices,
    host._localize,
    host._selectedUpdateStatus
  );
  const emptyLabel = host._localize("dashboard.filter_no_options");
  const noMatchesLabel = host._localize("dashboard.filter_no_matches");
  const yamlMode = host._yamlMode;

  const facetSections = html`
    ${yamlMode ? nothing : renderLabelsFilter(host)}
    ${areaOptions.length > 0
      ? html`<esphome-filter-section
          name=${host._localize("dashboard.filter_area")}
          search-placeholder=${host._localize("dashboard.filter_area")}
          empty-label=${emptyLabel}
          no-matches-label=${noMatchesLabel}
          ?searchable=${areaOptions.length > 8}
          .options=${areaOptions}
          .selected=${host._selectedAreas}
          @facet-change=${(e: CustomEvent<string[]>) => {
            host._selectedAreas = e.detail;
          }}
        ></esphome-filter-section>`
      : nothing}
    ${platformOptions.length > 1
      ? html`<esphome-filter-section
          name=${host._localize("dashboard.filter_platform")}
          search-placeholder=${host._localize("dashboard.filter_platform")}
          empty-label=${emptyLabel}
          no-matches-label=${noMatchesLabel}
          .options=${platformOptions}
          .selected=${host._selectedPlatforms}
          @facet-change=${(e: CustomEvent<string[]>) => {
            host._selectedPlatforms = e.detail;
          }}
        ></esphome-filter-section>`
      : nothing}
    ${yamlMode
      ? nothing
      : html`<esphome-filter-section
          name=${host._localize("dashboard.filter_status")}
          empty-label=${emptyLabel}
          no-matches-label=${noMatchesLabel}
          .options=${stateOptions}
          .selected=${host._selectedStates}
          @facet-change=${(e: CustomEvent<string[]>) => {
            host._selectedStates = e.detail;
          }}
        ></esphome-filter-section>`}
    ${!yamlMode && updateOptions.length > 0
      ? html`<esphome-filter-section
          name=${host._localize("dashboard.filter_update_status")}
          empty-label=${emptyLabel}
          no-matches-label=${noMatchesLabel}
          .options=${updateOptions}
          .selected=${host._selectedUpdateStatus}
          @facet-change=${(e: CustomEvent<string[]>) => {
            host._selectedUpdateStatus = e.detail;
          }}
        ></esphome-filter-section>`
      : nothing}
  `;

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
