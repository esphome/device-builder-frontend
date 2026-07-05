import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import memoizeOne from "memoize-one";
import type { ESPHomeAPI } from "../api/index.js";
import { DeviceState, type ConfiguredDevice } from "../api/types/devices.js";
import type { PairingSummary } from "../api/types/remote-build.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  buildOffloadPairingsContext,
  devicesContext,
  localizeContext,
  versionContext,
} from "../context/index.js";
import {
  dialogActionButtonStyles,
  dialogActionsRowStyles,
} from "../styles/dialog-action-buttons.js";
import { dialogChromeStyles } from "../styles/dialog-chrome.js";
import { espHomeStyles } from "../styles/shared.js";
import { runBulkUpdate } from "../util/bulk-update.js";
import { applyFacetFilters, type FacetSelection } from "../util/device-filter.js";
import { computeLabelUsage } from "../util/label-usage.js";
import { renderFacetSections } from "./filters/facet-sections.js";

import "./base-dialog.js";

/** The facets a bulk update opens expanded so the pre-checks are visible. */
const DEFAULT_EXPANDED = new Set(["status", "updates"]);

function defaultSelection(): FacetSelection {
  return {
    selectedLabels: [],
    selectedAreas: [],
    selectedPlatforms: [],
    selectedStates: [DeviceState.ONLINE],
    selectedUpdateStatus: ["update_available"],
  };
}

/**
 * Bulk firmware-update dialog opened from the command palette.

 * Renders the dashboard's own Filters accordion (via renderFacetSections,
 * label management off) so the facet set can't drift, pre-selecting
 * Online + Update available — the legacy "Update All" by default, minus
 * its blind attempts on offline devices. Confirm bulk-installs the
 * matched configurations.
 */
@customElement("esphome-update-all-dialog")
export class ESPHomeUpdateAllDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @consume({ context: apiContext })
  @state()
  private _api!: ESPHomeAPI;

  @consume({ context: versionContext, subscribe: true })
  @state()
  private _appVersion = "";

  @consume({ context: buildOffloadPairingsContext, subscribe: true })
  @state()
  private _pairings: Map<string, PairingSummary> | null = null;

  @state()
  private _open = false;

  @state()
  private _selection: FacetSelection = defaultSelection();

  // Memoized like the dashboard's facet pipeline so a re-render (or the
  // confirm read) over a large fleet doesn't refilter / re-tally on every
  // tick; the cache invalidates when devices or the selection ref changes.
  private _matchedMemo = memoizeOne(applyFacetFilters);
  private _labelUsageMemo = memoizeOne(computeLabelUsage);

  static styles = [
    espHomeStyles,
    dialogChromeStyles,
    dialogActionButtonStyles,
    dialogActionsRowStyles,
    css`
      esphome-base-dialog {
        --width: 460px;
      }

      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l);
      }

      .sections {
        display: flex;
        flex-direction: column;
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        overflow: hidden;
      }

      .summary {
        padding: var(--wa-space-m) 0 0;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }
    `,
  ];

  async open() {
    this._selection = defaultSelection();
    this._open = true;
    // Sections only exist after the open render; default-expand the two
    // facets carrying pre-checks. The helper doesn't bind `expanded`, so
    // these toggles are imperative and survive re-renders (as the popover
    // shell does over its own children).
    await this.updateComplete;
    for (const section of this._sectionEls()) {
      section.expanded = DEFAULT_EXPANDED.has(section.dataset.facetKey ?? "");
    }
  }

  close() {
    this._open = false;
  }

  private _sectionEls(): (HTMLElement & { expanded: boolean })[] {
    return Array.from(
      this.shadowRoot?.querySelectorAll<HTMLElement & { expanded: boolean }>(
        "[data-facet-key]"
      ) ?? []
    );
  }

  private _onAfterHide = (): void => {
    this._open = false;
  };

  private _onSectionToggle = (e: Event): void => {
    const target = e.target;
    if (target instanceof HTMLElement && "expanded" in target) {
      const section = target as HTMLElement & { expanded: boolean };
      section.expanded = !section.expanded;
    }
  };

  private _matched(): ConfiguredDevice[] {
    return this._matchedMemo(this._devices, this._selection);
  }

  protected render() {
    // Keep one <esphome-base-dialog> so a close flips ?open reactively and
    // wa-dialog's exit animation plays on every path. Gate only the body +
    // the facet/match compute on _open — this is a persistent child on the
    // hot `devices` context, so nothing should recompute while closed.
    const matched = this._open ? this._matched() : [];
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${this._localize("update_all_dialog.title")}
        @after-hide=${this._onAfterHide}
      >
        ${
          this._open
            ? html`
                <div class="sections" @filter-section-toggle=${this._onSectionToggle}>
                  ${renderFacetSections({
                    devices: this._devices,
                    localize: this._localize,
                    selection: this._selection,
                    labelUsage: this._labelUsageMemo(this._devices),
                    yamlMode: false,
                    manageLabels: false,
                    onChange: (patch) => {
                      this._selection = { ...this._selection, ...patch };
                    },
                  })}
                </div>
                <div class="summary" role="status">
                  ${this._localize("update_all_dialog.count", {
                    count: matched.length,
                  })}
                </div>
                <div class="actions">
                  <button class="btn btn--cancel" @click=${this.close}>
                    ${this._localize("layout.cancel")}
                  </button>
                  <button
                    class="btn btn--primary"
                    ?disabled=${matched.length === 0}
                    @click=${this._confirm}
                  >
                    ${this._localize("update_all_dialog.confirm")}
                  </button>
                </div>
              `
            : nothing
        }
      </esphome-base-dialog>
    `;
  }

  private _confirm = () => {
    const configurations = this._matched().map((d) => d.configuration);
    this.close();
    // runBulkUpdate owns the empty case (the Update button is disabled at
    // zero anyway), so no guard here.
    void runBulkUpdate(configurations, {
      api: this._api,
      localize: this._localize,
      appVersion: this._appVersion,
      pairings: this._pairings?.values() ?? [],
    });
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-update-all-dialog": ESPHomeUpdateAllDialog;
  }
}
