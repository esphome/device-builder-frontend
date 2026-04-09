import { consume } from "@lit/context";
import { mdiArrowCollapseAll, mdiArrowExpandAll, mdiMemory, mdiOpenInNew, mdiPlus } from "@mdi/js";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ComponentCatalogEntry } from "../../api/types.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext, apiContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { debounce } from "../../util/debounce.js";
import { registerMdiIcons } from "../../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/badge/badge.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/input/input.js";

registerMdiIcons({
  "arrow-collapse-all": mdiArrowCollapseAll,
  "arrow-expand-all": mdiArrowExpandAll,
  memory: mdiMemory,
  "open-in-new": mdiOpenInNew,
  plus: mdiPlus,
});

@customElement("esphome-component-catalog")
export class ESPHomeComponentCatalog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state()
  private _components: ComponentCatalogEntry[] = [];

  @state()
  private _categories: Array<{ id: string; name: string; count: number }> = [];

  @state()
  private _loading = true;

  @state()
  private _search = "";

  @state()
  private _category = "all";

  @state()
  private _expandedId: string | null = null;

  private _debouncedSearch = debounce(() => this._fetchComponents(), 300);

  /** Trigger initial or refresh load of the catalog. */
  public load() {
    this._fetchComponents();
  }

  private async _fetchComponents() {
    this._loading = true;
    try {
      const query = this._search.trim() || undefined;
      const category = this._category !== "all" ? this._category : undefined;
      const response = await this._api.getComponents({ query, category, limit: 50 });
      this._components = response.components;
      this._categories = response.categories;
    } catch (e) {
      console.error("Failed to load component catalog:", e);
    } finally {
      this._loading = false;
    }
  }

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: flex;
        height: 480px;
        gap: 0;
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
        overflow: hidden;
      }

      wa-input {
        width: 100%;
        flex-shrink: 0;
      }

      .grid-scroll {
        flex: 1;
        overflow-y: auto;
        padding-right: var(--wa-space-2xs);
      }

      .components-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: var(--wa-space-s);
        align-content: start;
      }

      .component-card {
        border-radius: var(--wa-border-radius-l);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        background: var(--wa-color-surface-default);
        padding: var(--wa-space-m);
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
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
        margin-top: -2px;
        color: var(--esphome-primary);
        font-size: 18px;
      }

      .expand-button wa-icon {
        transition: transform var(--wa-transition-normal) var(--wa-transition-easing);
      }

      .component-card-header {
        display: flex;
        align-items: flex-start;
        gap: var(--wa-space-s);
      }

      .component-image--placeholder {
        width: 48px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: var(--wa-border-radius-s);
        background: var(--wa-color-surface-subtle);
        flex-shrink: 0;
        color: var(--esphome-primary);
        font-size: 24px;
      }

      .component-card-header-text {
        flex: 1;
        min-width: 0;
      }

      .component-title {
        margin: 0;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
        line-height: 1.3;
      }

      .component-description {
        margin: 0;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
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
        gap: var(--wa-space-s);
        margin-top: auto;
      }

      .more-info {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        font-size: var(--wa-font-size-xs);
        color: var(--esphome-primary);
        text-decoration: none;
      }

      .more-info:hover {
        text-decoration: underline;
      }

      .more-info wa-icon {
        font-size: 13px;
      }

      .select-component {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: var(--wa-font-size-s);
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
    `,
  ];

  protected render() {
    if (this._loading) {
      return html`<div class="loading">${this._localize("device.loading_components")}</div>`;
    }

    const categories = this._buildCategories();

    return html`
      <div class="sidebar">
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
      </div>
      <div class="main">
        <wa-input
          type="search"
          .value=${this._search}
          @input=${this._onSearchInput}
          placeholder=${this._localize("device.search_components_placeholder")}
        ></wa-input>
        <div class="grid-scroll">
          <div class="components-grid">
            ${this._components.length
              ? this._components.map((c) => this._renderCard(c, c.id === this._expandedId))
              : html`<p class="empty">${this._localize("device.no_components_found")}</p>`}
          </div>
        </div>
      </div>
    `;
  }

  private _buildCategories() {
    const allCount = this._components.length;
    const cats = [{ id: "all", label: this._localize("device.component_category_all"), count: allCount }];
    for (const cat of this._categories) {
      cats.push({
        id: cat.id,
        label: this._localize(`device.component_category_${cat.id}`),
        count: cat.count,
      });
    }
    return cats;
  }

  private _renderCard(component: ComponentCatalogEntry, expanded: boolean) {
    return html`
      <article class="component-card ${expanded ? "component-card--expanded" : ""}">
        <div class="component-card-header">
          <div class="component-image--placeholder">
            <wa-icon library="mdi" name="memory"></wa-icon>
          </div>
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
          ${component.description}
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
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-component-catalog": ESPHomeComponentCatalog;
  }
}
