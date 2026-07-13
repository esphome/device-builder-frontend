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
import { customElement, property, query, queryAll, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry, FeaturedBundle } from "../../api/types/boards.js";
import type { ComponentCatalogEntry } from "../../api/types/components.js";
import { ComponentCategory } from "../../api/types/components.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { loadMoreFooterStyles } from "../../styles/load-more-footer.js";
import { espHomeStyles } from "../../styles/shared.js";
import { debounce } from "../../util/debounce.js";
import { isFeaturedId } from "../../util/featured-id.js";
import { IntersectionController } from "../../util/intersection-controller.js";
import { isVisible } from "../../util/is-visible.js";
import { PagedListController } from "../../util/paged-list-controller.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { ResizeController } from "../../util/resize-controller.js";
import { setsEqual } from "../../util/set-equal.js";
import { renderLoadMoreFooter } from "../shared/load-more-footer.js";
import { overflowingDescriptionIds } from "./component-catalog/description-overflow.js";
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
import "@home-assistant/webawesome/dist/components/tooltip/tooltip.js";

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

  private _list = new PagedListController<ComponentCatalogEntry>(this);

  // ``_components`` / ``_total`` read straight off the paged list so the
  // client-side filter helpers (visibleComponents, buildCategories) keep
  // their existing ``host._components`` / ``host._total`` access.
  get _components(): ComponentCatalogEntry[] {
    return this._list.items;
  }

  get _total(): number {
    return this._list.total;
  }

  @state() _categories: Array<{ id: string; name: string; count: number }> = [];
  @state() _search = "";
  @state() _category = "all";
  // Interface to probe via the ``provides`` filter (set by ``filterByDomain``
  // for a non-category reference domain); cleared on user-driven browsing.
  @state() _provides = "";
  @state() _expandedId: string | null = null;

  // Per-id tracking — a single broken image_url shouldn't pull every other
  // card down to the placeholder.
  @state() _imageFailed: Set<string> = new Set();

  // Cards whose clamped description actually overflows — the only ones
  // where the expand button reveals anything. Rebuilt after every render
  // and on host resize (wrap width changes truncation). The equality
  // check makes the updated() -> measure -> state cycle converge:
  // removing a button doesn't change the description's wrap width, so
  // the second pass measures the same set and stops.
  @state({
    hasChanged: (next: ReadonlySet<string>, old?: ReadonlySet<string>) =>
      !old || !setsEqual(next, old),
  })
  _overflowingDescriptions: ReadonlySet<string> = new Set();

  @query(".sentinel") private _sentinel?: HTMLElement | null;

  @queryAll(".component-description--clamp[data-component-id]")
  private _clampedDescriptions!: NodeListOf<HTMLElement>;

  private _resize = new ResizeController(this, () => this._measureDescriptionOverflow());

  private _intersection = new IntersectionController(this, () => this._list.loadMore());

  private _debouncedSearch = debounce(() => this._fetchComponents(), 300);

  // The board has addable recommendations and we're not locked to a category
  // set — the state where "Recommended" is the sensible landing/search scope.
  // Query-independent: availableFeaturedCount ignores the search box.
  private _prefersFeatured(): boolean {
    return (
      this.lockedCategories.length === 0 &&
      !!this.boardId &&
      availableFeaturedCount(this, { applyQuery: false }) > 0
    );
  }

  // "Recommended" and "All" both surface the board's recommendations (featured
  // cards + bundles); a specific category (Sensor, …) does not. Drives the
  // search auto-switch and bundle visibility off the *current* view, so
  // returning to All always re-shows them.
  private _recommendationInclusive(): boolean {
    return this._category === ComponentCategory.FEATURED || this._category === "all";
  }

  // Not in connectedCallback or prop-reactive: the catalog stays mounted
  // (hidden) inside its dialog whose parents mount on page load. Eager
  // fetching there would (a) burn calls per page load even without dialog
  // open, and (b) race the device-page's async board load — the first
  // request would go out with empty platform / board_id.
  public load() {
    this._provides = "";
    // Auto-select "Featured" when the board has recommendations still addable;
    // reset away from it when every recommendation is already configured.
    if (this._prefersFeatured()) {
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

  private _fetchComponents() {
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
    };
    // Snapshot _provides once for this cycle: a debounced search clears
    // _provides immediately but defers its reset, so a loadMore firing in that
    // window must not flip this cycle's later pages from provides-paging to
    // query-paging. The offset=0 fallback updates the snapshot so the rest of
    // the cycle stays consistent.
    let provides = this._provides;
    this._list.reset(async (offset, limit) => {
      // Interface probe first; a homeless interface (voltage_sampler) has no
      // matching id/name, so an empty first page means it was a plain domain
      // and we retry as a search (an i2c dependency still resolves). Clear
      // ``_provides`` on that empty branch so later fetches go straight to
      // search instead of re-probing. The probe/retry and the category
      // snapshot only matter on page 0; later pages reuse the resolved value.
      let response = provides
        ? await this._api.getComponents({ ...base, offset, limit, provides })
        : await this._api.getComponents({ ...base, offset, limit, query });
      if (offset === 0 && provides && response.components.length === 0) {
        this._provides = "";
        provides = "";
        response = await this._api.getComponents({ ...base, offset, limit, query });
      }
      if (offset === 0) this._categories = response.categories;
      return { items: response.components, total: response.total };
    });
  }

  static styles = [
    espHomeStyles,
    inputStyles,
    componentCatalogStyles,
    loadMoreFooterStyles,
  ];

  protected firstUpdated() {
    // A late web-font swap changes wrap heights without a resize or a
    // render, stranding stale expand buttons; re-measure once fonts
    // settle. Optional-chained: happy-dom has no document.fonts.
    document.fonts?.ready.then(() => this._measureDescriptionOverflow());
  }

  protected updated() {
    this._measureDescriptionOverflow();

    // The sidebar badge / auto-select read availableFeaturedCount over the
    // board's recommendations (fetch-independent), while the grid reads the
    // fetched featured cards; during prop settling (yaml/board/platform arrive
    // at different times) they can briefly disagree and strand the view on an
    // empty "Recommended" category. Once a featured fetch has settled, if its
    // grid is empty fall back to "all" so we never sit on "0 of N / No
    // components found". A search never reaches here: _onSearchInput moves to
    // "all" (where featured lead) the moment a term is typed, so this guards
    // only the no-search cold-open race and the all-configured board.
    // ``_provides`` stays excluded — that probe path never runs in Featured.
    if (
      !this._list.loading &&
      this.lockedCategories.length === 0 &&
      this._category === ComponentCategory.FEATURED &&
      !this._provides &&
      visibleComponents(this).length + filteredBundles(this).length === 0
    ) {
      this._category = "all";
      this._fetchComponents();
    }

    // Observe against the viewport (null root) so paging works whether the
    // grid scrolls itself or the surrounding dialog does; the sentinel is
    // still clipped by the scroll container, and only exists while more pages
    // remain (see render), so a missing one tears the observer down.
    //
    // Re-paging relies on each appended page overflowing the scroll container
    // so the sentinel re-crosses on the next scroll. That holds because a full
    // page far exceeds the container height and the only short page is the
    // last (hasMore=false, sentinel removed); a short non-final page never
    // occurs.
    this._intersection.observeIfPresent(this._sentinel, null, "200px");
  }

  protected render() {
    if (this._list.loading && !this._list.hasLoaded) {
      return html`<div class="loading">
        ${this._localize("device.loading_components")}
      </div>`;
    }

    const categories = buildCategories(this, this._localize);
    // When the parent locks us to a category set, the sidebar's filter
    // options are noise — the relevant categories are already pinned.
    const showSidebar = this.lockedCategories.length === 0;

    // Bundles (a board concept, like featured cards) surface wherever
    // recommendations belong: "Recommended" and "All". A specific category
    // (Sensor, …) stays clean.
    const bundles = this._recommendationInclusive() ? filteredBundles(this) : [];
    const visible = visibleComponents(this);
    const ambiguous = ambiguousNameIds(visible);

    return html`
      ${
        showSidebar
          ? html`<div class="sidebar">
              <p class="sidebar-label">
                ${this._localize("device.component_categories")}
              </p>
              ${categories.map(
                ({ id, label, count }) => html`
                  <button
                    class="category-btn ${
                      this._category === id ? "category-btn--active" : ""
                    }"
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
          : nothing
      }
      <div class="main">
        <input
          type="search"
          autocomplete="off"
          .value=${this._search}
          @input=${this._onSearchInput}
          placeholder=${this._localize("device.search_components_placeholder")}
        />
        ${
          !this._list.loading
            ? html`<span class="result-count"
                >${this._localize("device.components_count", {
                  visible: visible.length + bundles.length,
                  total: this._total + bundles.length,
                })}</span
              >`
            : nothing
        }
        <div class="grid-scroll">
          <div class="components-grid">
            ${
              this._list.loading
                ? html`<p class="empty">
                    ${this._localize("device.loading_components")}
                  </p>`
                : visible.length + bundles.length
                  ? html`
                      ${bundles.map((b) => renderBundleCard(this, b))}
                      ${visible.map((c) =>
                        renderCard(
                          this,
                          c,
                          c.id === this._expandedId,
                          // A featured card keeps its badge/preset styling
                          // wherever it lands (it now leads "All" too).
                          isFeaturedId(c.id),
                          this._localize,
                          ambiguous.has(c.id)
                        )
                      )}
                    `
                  : html`<p class="empty">
                      ${this._localize(
                        this._list.hasError
                          ? "device.components_load_error"
                          : "device.no_components_found"
                      )}
                    </p>`
            }
          </div>
          ${renderLoadMoreFooter({
            loadingMore: this._list.loadingMore,
            error: this._list.hasError && this._list.items.length > 0,
            hasMore: this._list.hasMore,
            localize: this._localize,
            loadingLabelKey: "device.loading_components",
            errorLabelKey: "device.components_load_more_error",
            onRetry: () => this._list.loadMore(),
            loadingClass: "empty",
          })}
        </div>
      </div>
    `;
  }

  _onToggleExpand(component: ComponentCatalogEntry) {
    this._expandedId = this._expandedId === component.id ? null : component.id;
  }

  // The catalog stays mounted (hidden) inside its dialog: a hidden
  // subtree measures 0/0 for every paragraph, so skip rather than wipe
  // the set on dialog close — the reopen's load() render re-measures.
  private _measureDescriptionOverflow() {
    if (!isVisible(this)) return;
    const next = overflowingDescriptionIds(this._clampedDescriptions);
    // The expanded card's unclamped text is excluded from measurement;
    // keep its id so collapsing doesn't flash the button out for a
    // frame before the post-collapse measure re-adds it.
    if (this._expandedId) next.add(this._expandedId);
    this._overflowingDescriptions = next;
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
    // "Recommended" is the no-search curated shortlist; a search moves to "all",
    // where the board's featured cards are ranked first (server-side), so every
    // match is visible with the most relevant on top and no term can strand the
    // grid (device-builder-frontend#1040, device-builder#1793). Clearing the
    // search returns to "Recommended". Only from these two recommendation views:
    // a search inside a specific category (Sensor, …) filters within it.
    if (this._recommendationInclusive() && this._prefersFeatured()) {
      this._category = this._search.trim() ? "all" : ComponentCategory.FEATURED;
    }
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
