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
import type {
  BoardCatalogEntry,
  ComponentCatalogEntry,
  FeaturedBundle,
} from "../../api/types.js";
import { ComponentCategory } from "../../api/types.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext, apiContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { debounce } from "../../util/debounce.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { componentCatalogStyles } from "./component-catalog/styles.js";
import {
  buildCategories,
  filteredBundles,
  visibleComponents,
} from "./component-catalog/filters.js";
import { renderBundleCard, renderCard } from "./component-catalog/renderers.js";

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
    // Auto-select "Featured" when the board has any recommendations; reset
    // away from it when reopening against a board without any.
    const featuredCount =
      (this.board?.featured_components?.length ?? 0) +
      (this.board?.featured_bundles?.length ?? 0);
    const hasFeatured =
      this.lockedCategories.length === 0 && !!this.boardId && featuredCount > 0;
    if (hasFeatured) {
      this._category = ComponentCategory.FEATURED;
    } else if (this._category === ComponentCategory.FEATURED) {
      this._category = "all";
    }
    this._fetchComponents();
  }

  // Filter to a specific component domain. If the domain matches a known
  // ComponentCategory we use the category filter (exact match against
  // output.gpio, output.ledc, …); otherwise fall back to the search query.
  public filterByDomain(domain: string) {
    const isCategory = Object.values(ComponentCategory).includes(
      domain as ComponentCategory
    );
    if (isCategory) {
      this._search = "";
      this._category = domain;
    } else {
      this._search = domain;
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
      const response = await this._api.getComponents({
        query,
        category,
        exclude_category,
        platform: this.platform || undefined,
        board_id: this.boardId || undefined,
        limit: 50,
      });
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
              >${visible.length + bundles.length} of ${this._total + bundles.length}
              components</span
            >`
          : ""}
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
                        this._localize
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
