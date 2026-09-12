/**
 * Shared accordion body for the dashboard's Filters popover and the
 * Update All dialog — the same set of facet sections (labels, area,
 * platform, status, updates) rendered from one place so the two
 * surfaces can't drift.
 *
 * Expand/collapse is intentionally NOT wired here: the popover shell
 * owns it by reaching into its slotted children, and the dialog does
 * the same over its own shadow children (keyed off ``data-facet-key``).
 * Each section emits the existing bubbling ``facet-change`` /
 * ``labels-filter-change``; selection state stays on the host.
 */
import { html, nothing, type TemplateResult } from "lit";
import type { ConfiguredDevice, Label } from "../../api/types/devices.js";
import type { LocalizeFunc } from "../../common/localize.js";
import type { FacetSelection } from "../../util/device-filter.js";
import {
  computeAreaFacet,
  computeNetworkFacet,
  computePlatformFacet,
  computeProjectFacet,
  computeStateFacet,
  computeUpdateFacet,
} from "../../util/facets.js";

import "./filter-section.js";
import "./labels-filter-section.js";

export interface FacetSectionsContext {
  devices: ConfiguredDevice[];
  localize: LocalizeFunc;
  selection: FacetSelection;
  labelUsage: Record<string, number>;
  yamlMode: boolean;
  /** Render the labels facet's create/edit/delete affordances. The
   *  dashboard manages labels; the Update All dialog is selection-only. */
  manageLabels: boolean;
  onChange: (patch: Partial<FacetSelection>) => void;
  onLabelDelete?: (label: Label) => void;
  onLabelEdit?: (label: Label) => void;
  onLabelCreate?: () => void;
}

function renderLabelsFilter(ctx: FacetSectionsContext): TemplateResult {
  return html`<esphome-labels-filter-section
    data-facet-key="labels"
    .managed=${ctx.manageLabels}
    .selected=${ctx.selection.selectedLabels}
    .usageCounts=${ctx.labelUsage}
    @labels-filter-change=${(e: CustomEvent<string[]>) => {
      ctx.onChange({ selectedLabels: e.detail });
    }}
    @request-delete-label=${(e: CustomEvent<Label>) => ctx.onLabelDelete?.(e.detail)}
    @request-edit-label=${(e: CustomEvent<Label>) => ctx.onLabelEdit?.(e.detail)}
    @request-create-label=${() => ctx.onLabelCreate?.()}
  ></esphome-labels-filter-section>`;
}

/**
 * The accordion sections, in canonical order. Mirrors the dashboard's
 * render rules: labels / status always render (status only off in YAML
 * mode), area / platform / project / network / updates surface only
 * when the fleet has something to filter by, and labels / status /
 * project / network / updates are suppressed in YAML mode (runtime +
 * metadata facets don't apply to YAML matches).
 */
export function renderFacetSections(ctx: FacetSectionsContext): TemplateResult {
  const { devices, localize, selection, yamlMode } = ctx;
  const areaOptions = computeAreaFacet(devices);
  const platformOptions = computePlatformFacet(devices);
  const projectOptions = computeProjectFacet(devices);
  const networkOptions = computeNetworkFacet(devices);
  const stateOptions = computeStateFacet(devices, localize, selection.selectedStates);
  const updateOptions = computeUpdateFacet(
    devices,
    localize,
    selection.selectedUpdateStatus
  );
  const emptyLabel = localize("dashboard.filter_no_options");
  const noMatchesLabel = localize("dashboard.filter_no_matches");

  return html`
    ${yamlMode ? nothing : renderLabelsFilter(ctx)}
    ${
      areaOptions.length > 0
        ? html`<esphome-filter-section
            data-facet-key="area"
            name=${localize("dashboard.filter_area")}
            search-placeholder=${localize("dashboard.filter_area")}
            empty-label=${emptyLabel}
            no-matches-label=${noMatchesLabel}
            ?searchable=${areaOptions.length > 8}
            .options=${areaOptions}
            .selected=${selection.selectedAreas}
            @facet-change=${(e: CustomEvent<string[]>) => {
              ctx.onChange({ selectedAreas: e.detail });
            }}
          ></esphome-filter-section>`
        : nothing
    }
    ${
      platformOptions.length > 1
        ? html`<esphome-filter-section
            data-facet-key="platform"
            name=${localize("dashboard.filter_platform")}
            search-placeholder=${localize("dashboard.filter_platform")}
            empty-label=${emptyLabel}
            no-matches-label=${noMatchesLabel}
            .options=${platformOptions}
            .selected=${selection.selectedPlatforms}
            @facet-change=${(e: CustomEvent<string[]>) => {
              ctx.onChange({ selectedPlatforms: e.detail });
            }}
          ></esphome-filter-section>`
        : nothing
    }
    ${
      // Both are mDNS-observed, so they're suppressed in YAML mode
      // alongside the other runtime facets. Project surfaces from one
      // bucket up (a single distributor build in an otherwise
      // hand-written fleet is still worth isolating), while network
      // needs two — a fleet that is entirely wifi learns nothing from
      // a one-option pill, same rule as platform.
      !yamlMode && projectOptions.length > 0
        ? html`<esphome-filter-section
            data-facet-key="project"
            name=${localize("dashboard.filter_project")}
            search-placeholder=${localize("dashboard.filter_project")}
            empty-label=${emptyLabel}
            no-matches-label=${noMatchesLabel}
            ?searchable=${projectOptions.length > 8}
            .options=${projectOptions}
            .selected=${selection.selectedProjects}
            @facet-change=${(e: CustomEvent<string[]>) => {
              ctx.onChange({ selectedProjects: e.detail });
            }}
          ></esphome-filter-section>`
        : nothing
    }
    ${
      !yamlMode && networkOptions.length > 1
        ? html`<esphome-filter-section
            data-facet-key="network"
            name=${localize("dashboard.filter_network")}
            empty-label=${emptyLabel}
            no-matches-label=${noMatchesLabel}
            .options=${networkOptions}
            .selected=${selection.selectedNetworks}
            @facet-change=${(e: CustomEvent<string[]>) => {
              ctx.onChange({ selectedNetworks: e.detail });
            }}
          ></esphome-filter-section>`
        : nothing
    }
    ${
      yamlMode
        ? nothing
        : html`<esphome-filter-section
            data-facet-key="status"
            name=${localize("dashboard.filter_status")}
            empty-label=${emptyLabel}
            no-matches-label=${noMatchesLabel}
            .options=${stateOptions}
            .selected=${selection.selectedStates}
            @facet-change=${(e: CustomEvent<string[]>) => {
              ctx.onChange({ selectedStates: e.detail });
            }}
          ></esphome-filter-section>`
    }
    ${
      !yamlMode && updateOptions.length > 0
        ? html`<esphome-filter-section
            data-facet-key="updates"
            name=${localize("dashboard.filter_update_status")}
            empty-label=${emptyLabel}
            no-matches-label=${noMatchesLabel}
            .options=${updateOptions}
            .selected=${selection.selectedUpdateStatus}
            @facet-change=${(e: CustomEvent<string[]>) => {
              ctx.onChange({ selectedUpdateStatus: e.detail });
            }}
          ></esphome-filter-section>`
        : nothing
    }
  `;
}
