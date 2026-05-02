import { consume } from "@lit/context";
import {
  mdiArrowCollapseAll,
  mdiArrowExpandAll,
  mdiMemory,
  mdiOpenInNew,
  mdiPackageVariantClosed,
  mdiPlus,
} from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
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
import { renderMarkdown } from "../../util/markdown.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import {
  parseConfiguredPlatforms,
  parseTopLevelComponents,
} from "../../util/yaml-serialize.js";

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
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  /** Device's target platform (e.g. "esp32"). Forwarded to the backend
   * so any per-platform `cv.SplitDefault` defaults are pre-resolved. */
  @property()
  platform = "";

  /** Device's board id (e.g. "esp32-c6-devkitc-1"). Forwarded to the
   * backend so once components grow board-level constraints the
   * catalog can narrow down to what this board can actually run.
   * Currently a no-op filter on the BE; sending it now so we don't
   * have to plumb it through later. */
  @property({ attribute: "board-id" })
  boardId = "";

  /** Full board metadata. Used to surface `featured_bundles` (those
   * aren't returned through `components/*`, only via `boards/get_board`)
   * and to render the bundle cards' "Recommended for {board name}"
   * section title. */
  @property({ attribute: false })
  board: BoardCatalogEntry | null = null;

  /** Current device YAML. Used to hide components that are already
   *  configured AND are not multi-conf — a single-instance component
   *  like `esphome:` or `wifi:` shouldn't show up in the catalog
   *  once it's in the YAML. */
  @property()
  yaml = "";

  /** When non-empty, locks the catalog to these categories (logical
   *  OR across the list) and hides the category sidebar. The
   *  "Add core configuration" dialog passes `CORE_CATEGORIES` so
   *  the same UI can drive both flows without showing irrelevant
   *  filter options. */
  @property({ attribute: false })
  lockedCategories: string[] = [];

  /** Categories to hide server-side. The normal "Add component"
   *  dialog passes `CORE_CATEGORIES` so the core/ota/time/update
   *  entries only appear in their dedicated dialog. Ignored when
   *  `lockedCategories` is set (a positive filter already restricts
   *  the set). */
  @property({ attribute: false })
  excludeCategories: string[] = [];

  @state()
  private _components: ComponentCatalogEntry[] = [];

  @state()
  private _categories: Array<{ id: string; name: string; count: number }> = [];

  @state()
  private _total = 0;

  @state()
  private _loading = true;

  @state()
  private _initialLoad = true;

  @state()
  private _search = "";

  @state()
  private _category = "all";

  @state()
  private _expandedId: string | null = null;

  /** Component IDs whose `image_url` errored out — those fall back to
   *  the memory-icon placeholder. Tracked per-id so a single broken
   *  image doesn't pull every other card down. */
  @state()
  private _imageFailed: Set<string> = new Set();

  private _debouncedSearch = debounce(() => this._fetchComponents(), 300);

  /**
   * Catalog list with two filters applied client-side:
   *
   *   1. Single-instance components are hidden once they're already
   *      in the YAML — `esphome:` shouldn't show up after it's been
   *      added. Multi-conf components (most platform components,
   *      `output`, `sensor`, …) and platform-style ids (anything
   *      containing a `.`) always stay visible.
   *
   *   2. In core-locked mode (the "Add core configuration" dialog),
   *      platform variants whose dependencies aren't satisfied get
   *      hidden — `time.zigbee` requires the `zigbee` component,
   *      `ota.zephyr_mcumgr` requires the nRF52-only `zephyr` build,
   *      and so on. A dep counts as satisfied when it's either (a)
   *      already configured in the user's YAML or (b) one of the
   *      core-compatible IDs the response itself contains (so
   *      `time.sntp` shows because `network` is in the response, but
   *      `time.gps` is hidden because `gps` is a misc component that
   *      neither the user nor the core dialog brings in).
   */
  private get _visibleComponents(): ComponentCatalogEntry[] {
    const present = this.yaml
      ? parseTopLevelComponents(this.yaml)
      : new Set<string>();
    // Set of `<domain>.<platform>` keys currently configured —
    // e.g. when the YAML has `time: [- platform: homeassistant]`
    // this contains `time.homeassistant`, which lets us hide the
    // matching catalog card if the platform is single-instance.
    const presentPlatforms = this.yaml
      ? parseConfiguredPlatforms(this.yaml)
      : new Set<string>();
    const lockedToCore = this.lockedCategories.length > 0;
    // The set of IDs that the core dialog can offer right now —
    // every component currently in the response. A dep that points
    // to one of these is satisfiable from inside this same flow.
    const coreCompatible = lockedToCore
      ? new Set(this._components.map((c) => c.id))
      : null;

    return this._components.filter((c) => {
      // (1) Hide single-instance components already configured.
      //     Two flavours of single-instance:
      //       a. bare top-level component (`web_server`, `wifi`) —
      //          hide when the matching `<id>:` block exists.
      //       b. platform variant (`time.homeassistant`) — hide
      //          when the same `<domain>.<platform>` is already
      //          listed under its umbrella block. Multi-conf
      //          platform variants (most of them — `output.gpio`,
      //          `sensor.dht`, …) skip this check and stay visible
      //          so the user can add another one.
      if (!c.multi_conf) {
        if (c.id.includes(".")) {
          if (presentPlatforms.has(c.id)) return false;
        } else if (present.has(c.id)) {
          return false;
        }
      }

      // (2) Core-locked: drop platform variants whose deps the user
      //     can't reasonably satisfy from this dialog. We only apply
      //     this to platform-style ids (`time.zigbee`, `ota.zephyr_mcumgr`,
      //     …); the bare core entries (api, wifi, …) shouldn't trip
      //     it because they don't have peer-component deps.
      if (
        coreCompatible &&
        c.id.includes(".") &&
        c.dependencies.length > 0
      ) {
        const allSatisfied = c.dependencies.every(
          (dep) => coreCompatible.has(dep) || present.has(dep),
        );
        if (!allSatisfied) return false;
      }

      return true;
    });
  }

  /**
   * Trigger initial or refresh load of the catalog. Called by the
   * parent dialog's `open()` — we deliberately do NOT fetch in
   * `connectedCallback` or in response to prop changes, because the
   * catalog stays mounted (hidden) inside the dialog and its parents
   * mount on page load. Eager fetching there would (a) burn 1+
   * `components/get_components` calls per page load even when the
   * user never opens the dialog, and (b) race the device-page's
   * async board load — the very first request would go out with
   * empty `platform` / `board_id` filters. Lazy load on open dodges
   * both problems: by the time the user clicks "Add component" the
   * board has long since arrived, and we issue exactly one request
   * per dialog open.
   */
  public load() {
    // Auto-select the "Featured" tab on open when the board has any
    // recommendations — that's the curated short list users on those
    // boards reach for first. Falls back to "all" otherwise (and resets
    // away from "featured" if the dialog is reopened against a board
    // without recommendations).
    const featuredCount =
      (this.board?.featured_components?.length ?? 0) +
      (this.board?.featured_bundles?.length ?? 0);
    const hasFeatured =
      this.lockedCategories.length === 0 &&
      !!this.boardId &&
      featuredCount > 0;
    if (hasFeatured) {
      this._category = ComponentCategory.FEATURED;
    } else if (this._category === ComponentCategory.FEATURED) {
      this._category = "all";
    }
    this._fetchComponents();
  }

  /**
   * Filter the catalog to a specific component domain (e.g. "output",
   * "sensor"). When the domain matches a known ComponentCategory we
   * use the category filter — that's an exact match against
   * `output.gpio`, `output.ledc`, ... — which is much more precise
   * than putting the word "output" through the search box (where it
   * also matches anything mentioning "output" in name or description).
   *
   * For domains that aren't categories (e.g. bus IDs like "i2c") we
   * fall back to the search query.
   */
  public filterByDomain(domain: string) {
    const isCategory = Object.values(ComponentCategory).includes(
      domain as ComponentCategory,
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
      // `lockedCategories` (set by the parent — e.g. CORE_CATEGORIES
      // for the core-config dialog) wins over the user's sidebar
      // selection. Otherwise fall back to the in-component filter,
      // with "all" meaning "no filter".
      const locked = this.lockedCategories.length > 0;
      const category: string | string[] | undefined = locked
        ? this.lockedCategories
        : this._category !== "all"
          ? this._category
          : undefined;
      const exclude_category: string[] | undefined =
        !locked && this.excludeCategories.length > 0
          ? this.excludeCategories
          : undefined;
      const platform = this.platform || undefined;
      const board_id = this.boardId || undefined;
      const response = await this._api.getComponents({
        query,
        category,
        exclude_category,
        platform,
        board_id,
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

  /**
   * Bundles surfaced from the board manifest, optionally filtered by
   * the search query. Bundles aren't returned through `components/*`
   * — they live on `boards/get_board` and we filter them client-side
   * so a search behaves consistently across featured + bundles +
   * regular components.
   */
  private get _filteredBundles(): FeaturedBundle[] {
    const bundles = this.board?.featured_bundles ?? [];
    const q = this._search.trim().toLowerCase();
    if (!q) return bundles;
    return bundles.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.description.toLowerCase().includes(q) ||
        b.id.toLowerCase().includes(q),
    );
  }

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      :host {
        display: flex;
        height: 480px;
        gap: 0;
      }

      :host([hidden]) {
        display: none;
      }

      .sidebar {
        width: 160px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
        padding-right: var(--wa-space-m);
        border-right: 1px solid var(--wa-color-surface-border);
        overflow-y: auto;
      }

      .sidebar-label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-subtle);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        margin: 0 0 var(--wa-space-2xs);
        flex-shrink: 0;
      }

      .category-btn {
        border: none;
        background: none;
        cursor: pointer;
        text-align: left;
        padding: var(--wa-space-xs) var(--wa-space-s);
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-normal);
        transition: background 0.1s;
        font-family: inherit;
        flex-shrink: 0;
      }

      .category-btn:hover {
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        color: var(--esphome-primary);
      }

      .category-btn--active {
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        color: var(--esphome-primary);
      }

      .category-btn-inner {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-xs);
      }

      .category-count {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 18px;
        height: 18px;
        padding: 0 4px;
        border-radius: 9px;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        background: var(--wa-color-surface-raised);
        color: var(--wa-color-text-subtle);
        flex-shrink: 0;
        box-sizing: border-box;
      }

      .category-btn--active .category-count {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .main {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
        padding-left: var(--wa-space-m);
        padding-top: 3px;
        padding-right: 3px;
        overflow: hidden;
      }

      input[type="search"] {
        flex-shrink: 0;
      }

      .result-count {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        flex-shrink: 0;
        margin-top: -6px;
      }

      .grid-scroll {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding-right: var(--wa-space-2xs);
      }

      /* Cards have a 56px thumbnail + title + expand button + footer
         actions, so they need a fair bit of horizontal room before
         the title stops being readable. Use auto-fill + minmax so
         the grid drops from 2 → 1 column as soon as a card would
         shrink below ~340px, regardless of the dialog/sidebar
         width. Avoids hard viewport breakpoints for the card count. */
      .components-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
        gap: 8px;
        align-content: start;
      }

      /* Below ~600px (modal viewport on phones) the fixed 160px
         category sidebar + search input no longer fit alongside the
         grid. Collapse the sidebar into a horizontal scrolling chip
         row above the grid. The grid itself already collapses to a
         single column via the auto-fill rule above. */
      @media (max-width: 600px) {
        :host {
          flex-direction: column;
          height: auto;
          max-height: 70vh;
        }

        .sidebar {
          width: 100%;
          flex-direction: row;
          gap: var(--wa-space-2xs);
          padding-right: 0;
          padding-bottom: var(--wa-space-s);
          margin-bottom: var(--wa-space-s);
          overflow-x: auto;
          overflow-y: hidden;
          border-right: none;
          border-bottom: 1px solid var(--wa-color-surface-border);
        }

        .sidebar-label {
          display: none;
        }

        .category-btn {
          flex-shrink: 0;
          white-space: nowrap;
        }

        .main {
          padding-left: 0;
          padding-right: 0;
        }
      }

      .component-card {
        border-radius: var(--wa-border-radius-l);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-default);
        padding: var(--wa-space-s) var(--wa-space-m);
        box-sizing: border-box;
        min-width: 0;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 6px;
        transition: border-color var(--wa-transition-normal) var(--wa-transition-easing);
      }

      .component-card:hover {
        border-color: var(--esphome-primary);
      }

      .component-card--expanded {
        grid-column: 1 / -1;
      }

      .expand-button {
        border: none;
        background: none;
        cursor: pointer;
        padding: 2px;
        border-radius: 4px;
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
        color: var(--esphome-primary);
        font-size: 15px;
      }

      .expand-button wa-icon {
        transition: transform var(--wa-transition-normal) var(--wa-transition-easing);
      }

      .component-card-header {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .component-image,
      .component-image--placeholder {
        width: 56px;
        height: 56px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--wa-border-radius-m);
        background: var(--wa-color-surface-subtle);
        flex-shrink: 0;
        color: var(--esphome-primary);
        font-size: 28px;
        box-sizing: border-box;
      }

      .component-image {
        padding: 4px;
      }

      .component-image img {
        width: 100%;
        height: 100%;
        object-fit: contain;
      }

      /* ESPHome's monochrome line-art SVG illustrations are
         black-on-transparent — invisible against the dark surface
         in dark mode. --esphome-svg-filter is none in light mode
         and invert(1)+hue-rotate(180deg) in dark mode, defined at
         the document root in apply-theme.ts. The attribute selector
         scopes this to SVGs only — JPGs / PNGs (board photos, etc.)
         keep their original colours. */
      .component-image img[src$=".svg"] {
        filter: var(--esphome-svg-filter, none);
      }

      .component-card-header-text {
        flex: 1;
        min-width: 0;
      }

      .component-title {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
        line-height: 1.3;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .component-description {
        margin: 0;
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.4;
      }

      .component-description--clamp {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .card-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-xs);
        margin-top: auto;
      }

      .more-info {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        font-size: var(--wa-font-size-2xs);
        color: var(--esphome-primary);
        text-decoration: none;
      }

      .more-info:hover {
        text-decoration: underline;
      }

      .more-info wa-icon {
        font-size: 11px;
      }

      .select-component {
        display: flex;
        align-items: center;
        gap: 3px;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-primary);
        cursor: pointer;
      }

      .empty {
        text-align: center;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
        padding: var(--wa-space-xl);
        grid-column: 1 / -1;
      }

      .loading {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }

      /* Cards in the "Featured" view get a subtle primary-coloured
         border accent so they read as the curated set, distinct from
         the regular catalog. */
      .component-card--featured {
        border-color: color-mix(
          in srgb,
          var(--esphome-primary),
          transparent 70%
        );
      }

      .bundle-badge {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-primary);
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        border-radius: var(--wa-border-radius-s);
        padding: 1px 6px;
      }

      .bundle-badge wa-icon {
        font-size: 11px;
      }
    `,
  ];

  protected render() {
    if (this._initialLoad && this._loading) {
      return html`<div class="loading">${this._localize("device.loading_components")}</div>`;
    }

    const categories = this._buildCategories();
    // When the parent locks us to a category set (e.g. core-config
    // dialog passes `CORE_CATEGORIES`), the sidebar's filter options
    // are noise — the categories that matter are already pinned.
    // Hide the sidebar entirely so the catalog acts like a simple
    // filtered list.
    const showSidebar = this.lockedCategories.length === 0;

    // Bundle cards live alongside featured components and only surface
    // in the dedicated "Featured" view. In every other view the grid
    // is just the regular component slice from the backend.
    const filteredBundles =
      this._category === ComponentCategory.FEATURED ? this._filteredBundles : [];

    return html`
      ${showSidebar
        ? html`<div class="sidebar">
            <p class="sidebar-label">${this._localize("device.component_categories")}</p>
            ${categories.map(
              ({ id, label, count }) => html`
                <button
                  class="category-btn ${this._category === id ? "category-btn--active" : ""}"
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
          .value=${this._search}
          @input=${this._onSearchInput}
          placeholder=${this._localize("device.search_components_placeholder")}
        />
        ${!this._loading
          ? html`<span class="result-count">${this._visibleComponents.length + filteredBundles.length} of ${this._total + filteredBundles.length} components</span>`
          : ""}
        <div class="grid-scroll">
          <div class="components-grid">
            ${this._loading
              ? html`<p class="empty">${this._localize("device.loading_components")}</p>`
              : this._visibleComponents.length + filteredBundles.length
                ? html`
                    ${filteredBundles.map((b) => this._renderBundleCard(b))}
                    ${this._visibleComponents.map((c) =>
                      this._renderCard(
                        c,
                        c.id === this._expandedId,
                        this._category === ComponentCategory.FEATURED,
                      ),
                    )}
                  `
                : html`<p class="empty">${this._localize("device.no_components_found")}</p>`}
          </div>
        </div>
      </div>
    `;
  }

  private _renderBundleCard(bundle: FeaturedBundle) {
    return html`
      <article class="component-card component-card--featured">
        <div class="component-card-header">
          <div class="component-image--placeholder">
            <wa-icon library="mdi" name="package-variant-closed"></wa-icon>
          </div>
          <div class="component-card-header-text">
            <h3 class="component-title">${bundle.name}</h3>
          </div>
          <span class="bundle-badge">
            <wa-icon library="mdi" name="package-variant-closed"></wa-icon>
            ${this._localize("device.featured_bundle_badge")}
          </span>
        </div>
        ${bundle.description
          ? html`<p class="component-description component-description--clamp">
              ${renderMarkdown(bundle.description)}
            </p>`
          : nothing}
        <div class="card-footer">
          <span></span>
          <div class="select-component" @click=${() => this._onAddBundle(bundle)}>
            <wa-icon library="mdi" name="plus"></wa-icon>
            ${this._localize("device.add_component_action")}
          </div>
        </div>
      </article>
    `;
  }

  private _buildCategories() {
    // Hide categories the parent told us to exclude (e.g. the regular
    // "Add component" dialog passes CORE_CATEGORIES so the sidebar
    // doesn't list "Core" / "Update" / "OTA" / "Time" buttons that
    // would return empty results — those live in the dedicated core
    // dialog instead). The total count is also adjusted to match.
    const excluded = new Set(this.excludeCategories);
    const visibleCats = this._categories.filter((c) => !excluded.has(c.id));
    // The "Featured" category gets its own pinned slot at the top —
    // peel it out of the alphabetical list so it doesn't appear twice.
    const featuredCat = visibleCats.find(
      (c) => c.id === ComponentCategory.FEATURED,
    );
    const bundleCount = this.board?.featured_bundles?.length ?? 0;
    // Bundles are surfaced under the Featured tab too but live on the
    // board manifest, not in the components categories response. Add
    // them to the headline count so the badge matches the rendered
    // grid.
    const featuredBadge = featuredCat
      ? featuredCat.count + bundleCount
      : bundleCount;
    const sortableCats = visibleCats.filter(
      (c) => c.id !== ComponentCategory.FEATURED,
    );
    const visibleTotal = excluded.size
      ? sortableCats.reduce((sum, c) => sum + c.count, 0)
      : this._total;
    // Resolve each category's display label first (i18n key when one
    // exists, otherwise the backend-provided fallback), then sort
    // alphabetically by what the user actually reads. The backend
    // sorts by component count which doesn't help discovery — finding
    // "Sensor" in a 30-entry list is much faster when it's in
    // alphabetical order. "Featured" (when present) and "All" stay
    // pinned at the top.
    const collator = new Intl.Collator(undefined, { sensitivity: "base" });
    const sortedCats = sortableCats
      .map((cat) => {
        const key = `device.component_category_${cat.id}`;
        const translated = this._localize(key);
        return {
          id: cat.id,
          label: translated !== key ? translated : cat.name,
          count: cat.count,
        };
      })
      .sort((a, b) => collator.compare(a.label, b.label));
    const cats: Array<{ id: string; label: string; count: number }> = [];
    if (featuredBadge > 0) {
      cats.push({
        id: ComponentCategory.FEATURED,
        label: this._localize("device.component_category_featured"),
        count: featuredBadge,
      });
    }
    cats.push({
      id: "all",
      label: this._localize("device.component_category_all"),
      count: visibleTotal,
    });
    cats.push(...sortedCats);
    return cats;
  }

  private _renderCard(
    component: ComponentCatalogEntry,
    expanded: boolean,
    featured: boolean = false,
  ) {
    const hasImage =
      !!component.image_url && !this._imageFailed.has(component.id);
    return html`
      <article
        class="component-card ${expanded ? "component-card--expanded" : ""} ${featured ? "component-card--featured" : ""}"
      >
        <div class="component-card-header">
          ${hasImage
            ? html`<div class="component-image">
                <img
                  src=${component.image_url}
                  alt=${component.name}
                  referrerpolicy="no-referrer"
                  loading="lazy"
                  @error=${() => this._onImageError(component.id)}
                />
              </div>`
            : html`<div class="component-image--placeholder">
                <wa-icon library="mdi" name="memory"></wa-icon>
              </div>`}
          <div class="component-card-header-text">
            <h3 class="component-title">${component.name}</h3>
          </div>
          <button
            class="expand-button"
            type="button"
            aria-pressed=${expanded}
            title=${this._localize("wizard.expand_board")}
            @click=${() => this._onToggleExpand(component)}
          >
            <wa-icon
              library="mdi"
              name=${expanded ? "arrow-collapse-all" : "arrow-expand-all"}
            ></wa-icon>
          </button>
        </div>
        <p class="component-description ${expanded ? "" : "component-description--clamp"}">
          ${renderMarkdown(component.description)}
        </p>
        <div class="card-footer">
          <a class="more-info" href=${component.docs_url} target="_blank" rel="noreferrer">
            ${this._localize("device.more_info")}
            <wa-icon library="mdi" name="open-in-new"></wa-icon>
          </a>
          <div class="select-component" @click=${() => this._onAdd(component)}>
            <wa-icon library="mdi" name="plus"></wa-icon>
            ${this._localize("device.add_component_action")}
          </div>
        </div>
      </article>
    `;
  }

  private _onToggleExpand(component: ComponentCatalogEntry) {
    this._expandedId = this._expandedId === component.id ? null : component.id;
  }

  private _onImageError(id: string) {
    if (this._imageFailed.has(id)) return;
    const next = new Set(this._imageFailed);
    next.add(id);
    this._imageFailed = next;
  }

  private _onSearchInput(ev: Event) {
    this._search = (ev.target as HTMLInputElement).value;
    this._debouncedSearch();
  }

  private _onAdd(component: ComponentCatalogEntry) {
    this.dispatchEvent(
      new CustomEvent("add-component", {
        detail: { component },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onAddBundle(bundle: FeaturedBundle) {
    this.dispatchEvent(
      new CustomEvent("add-bundle", {
        detail: { bundle, boardId: this.boardId },
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-component-catalog": ESPHomeComponentCatalog;
  }
}
