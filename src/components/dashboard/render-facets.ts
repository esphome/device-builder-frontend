/**
 * Dashboard facet-filter row rendering (split out of render-toolbar.ts
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
import "../facets/facet-filter.js";
import "./filters-menu.js";

export function renderLabelsFilter(host: ESPHomePageDashboard): TemplateResult {
  // Labels facet keeps its own component because its popover
  // hosts the inline rename / delete / create affordances that
  // the generic ``<esphome-facet-filter>`` doesn't expose. Visual
  // language is shared via the ``facetStyles`` stylesheet.
  return html`<esphome-labels-filter
    .selected=${host._selectedLabels}
    .usageCounts=${host._computeLabelUsage()}
    @labels-filter-change=${(e: CustomEvent<string[]>) => {
      host._selectedLabels = e.detail;
    }}
    @request-delete-label=${(e: CustomEvent<Label>) => {
      host._openConfirm({ kind: "delete-label", label: e.detail });
    }}
  ></esphome-labels-filter>`;
}

/** Facets row — every facet pill collapses into a single "Filters"
 *  button + popover so the toolbar stays one line regardless of how
 *  many facets or selections are active (an inline pill row overflows
 *  once selection badges widen the pills). The labels pill always
 *  renders inside the popover (its popover is the create path even
 *  when the catalog is empty); area / platform / status only render
 *  when the configured-device list has at least one usable value to
 *  filter by, so a fresh dashboard with a single-platform fleet
 *  doesn't sprout an empty / single-bucket pill that adds no signal.
 *
 *  In YAML-search mode the *labels*, *status*, and *updates*
 *  facets are suppressed — labels are device metadata (not in the
 *  YAML), and online/offline plus update/modified state are runtime
 *  (also not in the YAML), so filtering YAML matches by any of them
 *  is misleading. Area and platform stay because both come from the
 *  YAML itself. The updates facet additionally renders only when the
 *  fleet has something to update (no 0/0 noise pill). */
export function renderFacets(host: ESPHomePageDashboard): TemplateResult {
  const areaOptions = computeAreaFacet(host._devices);
  const platformOptions = computePlatformFacet(host._devices);
  const stateOptions = computeStateFacet(host._devices, host._localize);
  const updateOptions = computeUpdateFacet(
    host._devices,
    host._localize,
    host._selectedUpdateStatus
  );
  const multiSelectedLabel = host._localize("dashboard.filter_multi_selected", {
    count: "{count}",
  });
  const clearLabel = host._localize("dashboard.filter_clear_all");
  const yamlMode = host._yamlMode;

  // Built once; rendered inline or slotted into the menu below so the
  // facet wiring isn't duplicated across the two layouts.
  const facetPills = html`
    ${yamlMode ? nothing : renderLabelsFilter(host)}
    ${areaOptions.length > 0
      ? html`<esphome-facet-filter
          name=${host._localize("dashboard.filter_area")}
          search-placeholder=${host._localize("dashboard.filter_area")}
          clear-label=${clearLabel}
          multi-selected-label=${multiSelectedLabel}
          ?searchable=${areaOptions.length > 8}
          .options=${areaOptions}
          .selected=${host._selectedAreas}
          @facet-change=${(e: CustomEvent<string[]>) => {
            host._selectedAreas = e.detail;
          }}
        ></esphome-facet-filter>`
      : nothing}
    ${platformOptions.length > 1
      ? html`<esphome-facet-filter
          name=${host._localize("dashboard.filter_platform")}
          search-placeholder=${host._localize("dashboard.filter_platform")}
          clear-label=${clearLabel}
          multi-selected-label=${multiSelectedLabel}
          .options=${platformOptions}
          .selected=${host._selectedPlatforms}
          @facet-change=${(e: CustomEvent<string[]>) => {
            host._selectedPlatforms = e.detail;
          }}
        ></esphome-facet-filter>`
      : nothing}
    ${yamlMode
      ? nothing
      : html`<esphome-facet-filter
          name=${host._localize("dashboard.filter_status")}
          clear-label=${clearLabel}
          multi-selected-label=${multiSelectedLabel}
          .options=${stateOptions}
          .selected=${host._selectedStates}
          @facet-change=${(e: CustomEvent<string[]>) => {
            host._selectedStates = e.detail;
          }}
        ></esphome-facet-filter>`}
    ${!yamlMode && updateOptions.length > 0
      ? html`<esphome-facet-filter
          name=${host._localize("dashboard.filter_update_status")}
          clear-label=${clearLabel}
          multi-selected-label=${multiSelectedLabel}
          .options=${updateOptions}
          .selected=${host._selectedUpdateStatus}
          @facet-change=${(e: CustomEvent<string[]>) => {
            host._selectedUpdateStatus = e.detail;
          }}
        ></esphome-facet-filter>`
      : nothing}
  `;

  // Badge / "Clear all" track facet selections only; a lone active
  // search term is cleared from the search box's own clear control,
  // not surfaced here.
  return html`
    <div class="filter-group">
      <esphome-filters-menu
        .activeCount=${host._activeFacetCount}
        button-label=${host._localize("dashboard.filter_menu_button")}
        clear-label=${clearLabel}
        count-label=${host._localize(
          host._activeFacetCount === 1
            ? "dashboard.filter_menu_active_singular"
            : "dashboard.filter_menu_active_plural",
          { count: String(host._activeFacetCount) }
        )}
        @clear-filters=${host._clearAllFilters}
      >
        ${facetPills}
      </esphome-filters-menu>
    </div>
  `;
}
