import { consume } from "@lit/context";
import {
  mdiArrowCollapseAll,
  mdiArrowExpandAll,
  mdiMemory,
  mdiOpenInNew,
  mdiPackageVariantClosed,
  mdiPlus,
} from "@mdi/js";
import { html, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry, FeaturedBundle } from "../../api/types/boards.js";
import type { ComponentCatalogEntry } from "../../api/types/components.js";
import { ComponentCategory } from "../../api/types/components.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { debounce } from "../../util/debounce.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import {
  ambiguousNameIds,
  availableFeaturedCount,
  buildCategories,
  filteredBundles,
  visibleComponents,
} from "./component-catalog/filters.js";
import { renderBundleCard, renderCard } from "./component-catalog/renderers.js";
import { componentCatalogStyles } from "./component-catalog/styles.js";

import "@home-assistant/webawesome/dist/components/badge/badge.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "arrow-collapse-all": mdiArrowCollapseAll,
  "arrow-expand-all": mdiArrowExpandAll,
  memory: mdiMemory,
  "open-in-new": mdiOpenInNew,
  "package-variant-closed": mdiPackageVariantClosed,
  plus: mdiPlus,
});

@customElement("esphome-component-catalog")
export class ESPHomeComponentCatalog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;
  @consume({ context: apiContext }) _api!: ESPHomeAPI;

  // Forwarded to the backend so per-platform cv.SplitDefault defaults are pre-resolved.
  @property() platform = "";

  // Forwarded so once components grow board-level constraints the catalog can
  // narrow. Currently a no-op on the BE; plumbing now to avoid later churn.
  @property({ attribute: "board-id" }) boardId = "";

  // Used to surface featured_bundles (not on components/*) and to render
  // the bundle cards' "Recommended for {board}" section title.
  @property({ attribute: false }) board: BoardCatalogEntry | null = null;

  // Current YAML — used to hide single-instance components already configured.
  @property() yaml = "";

  // When non-empty, locks the catalog to these categories and hides the
  // sidebar. The core-config dialog passes CORE_CATEGORIES.
  @property({ attribute: false }) lockedCategories: string[] = [];

  // Hidden server-side. Normal "Add component" dialog passes CORE_CATEGORIES
  // so core/ota/time/update entries only appear in their dedicated dialog.
  // Ignored when lockedCategories is set.
  @property({ attribute: false }) excludeCategories: string[] = [];

  @state() _components: ComponentCatalogEntry[] = [];
  @state() _categories: Array<{ id: string; name: string; count: number }> = [];
  @state() _total = 0;
  @state() _loading = true;
  @state() _initialLoad = true;
  @state() _search = "";
  @state() _category = "all";
  // Interface to probe via the ``provides`` filter (set by ``filterByDomain``
  // for a non-category reference domain); cleared on user-driven browsing.
  @state() _provides = "";
  @state() _expandedId: string | null = null;

  // Per-id tracking — a single broken image_url shouldn't pull every other
  // card down to the placeholder.
  @state() _imageFailed: Set<string> = new Set();

  private _debouncedSearch = debounce(() => this._fetchComponents(), 300);

  // Not in connectedCallback or prop-reactive: the catalog stays mounted
  // (hidden) inside its dialog whose parents mount on page load. Eager
  // fetching there would (a) burn calls per page load even without dialog
  // open, and (b) race the device-page's async board load — the first
  // request would go out with empty platform / board_id.
  public load() {
    this._provides = "";
    // Auto-select "Featured" when the board has recommendations still addable;
    // reset away from it when every recommendation is already configured.
    const hasFeatured =
      this.lockedCategories.length === 0 &&
      !!this.boardId &&
      availableFeaturedCount(this) > 0;
    if (hasFeatured) {
      this._category = ComponentCategory.FEATURED;
    } else if (this._category === ComponentCategory.FEATURED) {
      this._category = "all";
    }
    this._fetchComponents();
  }

  // Filter to a specific component domain. A known ComponentCategory uses the
  // category filter (output.gpio, output.ledc, …); anything else may be a
  // component id/stem OR a homeless interface (voltage_sampler), so we probe
  // ``provides`` and fall back to a search when it yields nothing.
  public filterByDomain(domain: string) {
    const isCategory = Object.values(ComponentCategory).includes(
      domain as ComponentCategory
    );
    if (isCategory) {
      this._search = "";
      this._provides = "";
      this._category = domain;
    } else {
      this._search = domain;
      this._provides = domain;
      this._category = "all";
    }
    this._fetchComponents();
  }

  private async _fetchComponents() {
    this._loading = true;
    try {
      const query = this._search.trim() || undefined;
      // lockedCategories (parent-set, e.g. CORE_CATEGORIES) wins over the
      // user's sidebar selection.
      const locked = this.lockedCategories.length > 0;
      const category: string | string[] | undefined = locked
        ? this.lockedCategories
        : this._category !== "all"
          ? this._category
          : undefined;
      const exclude_category: string[] | undefined =
        !locked && this.excludeCategories.length > 0 ? this.excludeCategories : undefined;
      const base = {
        category,
        exclude_category,
        platform: this.platform || undefined,
        board_id: this.boardId || undefined,
        limit: 50,
      };
      // Interface probe first; a homeless interface (voltage_sampler) has no
      // matching id/name, so an empty result means it was a plain domain and
      // we retry as a search (an i2c dependency still resolves). Clear
      // ``_provides`` on that empty branch so a later fetch (board/platform
      // prop change) goes straight to search instead of re-probing.
      let response = this._provides
        ? await this._api.getComponents({ ...base, provides: this._provides })
        : await this._api.getComponents({ ...base, query });
      if (this._provides && response.components.length === 0) {
        this._provides = "";
        response = await this._api.getComponents({ ...base, query });
      }
      this._components = response.components;
      this._categories = response.categories;
      this._total = response.total;
    } catch (e) {
      console.error("Failed to load component catalog:", e);
    } finally {
      this._loading = false;
      this._initialLoad = false;
    }
  }

  static styles = [espHomeStyles, inputStyles, componentCatalogStyles];

  // The sidebar badge / auto-select read availableFeaturedCount over the board's
  // recommendations (fetch-independent), while the grid reads the fetched
  // featured cards; during prop settling (yaml/board/platform arrive at
  // different times) they can briefly disagree and strand the view on an empty
  // "Recommended" category. Once a featured fetch has settled, if its grid is
  // empty fall back to "all" so we never sit on "0 of N / No components found".
  // Scoped to the unfiltered Featured view: search/provides are applied
  // server-side, so an active filter that matches no recommendation empties the
  // grid legitimately and must render "No components found", not bounce to All.
  protected updated() {
    if (
      this._loading ||
      this.lockedCategories.length > 0 ||
      this._category !== ComponentCategory.FEATURED ||
      this._search.trim() ||
      this._provides
    ) {
      return;
    }
    if (visibleComponents(this).length + filteredBundles(this).length === 0) {
      this._category = "all";
      this._fetchComponents();
    }
  }

  protected render() {
    if (this._initialLoad && this._loading) {
      return html`<div class="loading">
        ${this._localize("device.loading_components")}
      </div>`;
    }

    const categories = buildCategories(this, this._localize);
    // When the parent locks us to a category set, the sidebar's filter
    // options are noise — the relevant categories are already pinned.
    const showSidebar = this.lockedCategories.length === 0;

    // Bundles only surface in the dedicated "Featured" view.
    const bundles =
      this._category === ComponentCategory.FEATURED ? filteredBundles(this) : [];
    const visible = visibleComponents(this);
    const ambiguous = ambiguousNameIds(visible);

    return html`
      ${showSidebar
        ? html`<div class="sidebar">
            <p class="sidebar-label">${this._localize("device.component_categories")}</p>
            ${categories.map(
              ({ id, label, count }) => html`
                <button
                  class="category-btn ${this._category === id
                    ? "category-btn--active"
                    : ""}"
                  type="button"
                  @click=${() => {
                    this._category = id;
                    this._provides = "";
                    this._fetchComponents();
                  }}
                >
                  <span class="category-btn-inner">
                    <span>${label}</span>
                    <span class="category-count">${count}</span>
                  </span>
                </button>
              `
            )}
          </div>`
        : nothing}
      <div class="main">
        <input
          type="search"
          autocomplete="off"
          .value=${this._search}
          @input=${this._onSearchInput}
          placeholder=${this._localize("device.search_components_placeholder")}
        />
        ${!this._loading
          ? html`<span class="result-count"
              >${this._localize("device.components_count", {
                visible: visible.length + bundles.length,
                total: this._total + bundles.length,
              })}</span
            >`
          : nothing}
        <div class="grid-scroll">
          <div class="components-grid">
            ${this._loading
              ? html`<p class="empty">${this._localize("device.loading_components")}</p>`
              : visible.length + bundles.length
                ? html`
                    ${bundles.map((b) => renderBundleCard(this, b))}
                    ${visible.map((c) =>
                      renderCard(
                        this,
                        c,
                        c.id === this._expandedId,
                        this._category === ComponentCategory.FEATURED,
                        this._localize,
                        ambiguous.has(c.id)
                      )
                    )}
                  `
                : html`<p class="empty">
                    ${this._localize("device.no_components_found")}
                  </p>`}
          </div>
        </div>
      </div>
    `;
  }

  _onToggleExpand(component: ComponentCatalogEntry) {
    this._expandedId = this._expandedId === component.id ? null : component.id;
  }

  _onImageError(id: string) {
    if (this._imageFailed.has(id)) return;
    const next = new Set(this._imageFailed);
    next.add(id);
    this._imageFailed = next;
  }

  private _onSearchInput = (ev: Event) => {
    this._search = (ev.target as HTMLInputElement).value;
    this._provides = "";
    this._debouncedSearch();
  };

  _onAdd(component: ComponentCatalogEntry) {
    this.dispatchEvent(
      new CustomEvent("add-component", {
        detail: { component },
        bubbles: true,
        composed: true,
      })
    );
  }

  _onAddBundle(bundle: FeaturedBundle) {
    this.dispatchEvent(
      new CustomEvent("add-bundle", {
        detail: { bundle, boardId: this.boardId },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-component-catalog": ESPHomeComponentCatalog;
  }
}
