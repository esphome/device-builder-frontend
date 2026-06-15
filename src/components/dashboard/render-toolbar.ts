import { html, nothing, type TemplateResult } from "lit";
import { DashboardView } from "../../api/types/system.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";
import { renderFacets } from "./render-facets.js";
import { renderYamlPreviewPivot } from "./render-yaml.js";

export function renderViewToggle(host: ESPHomePageDashboard): TemplateResult {
  const view = host._view;
  const yaml = host._yamlMode;
  const cardsLabel = host._localize("dashboard.view_cards");
  const tableLabel = host._localize("dashboard.view_table");
  const yamlLabel = host._localize("yaml_search.switch_to_yaml");
  // Up to three mutually-exclusive view options: cards (default), table,
  // and — only in Expert Mode — YAML search (a list of device titles that
  // expands to show matching YAML snippets when the user types a query).
  return html`
    <div
      class="view-toggle"
      role="group"
      aria-label=${host._localize("dashboard.view_toggle_group_label")}
    >
      <button
        class="view-toggle-btn ${!yaml && view === DashboardView.CARDS ? "active" : ""}"
        type="button"
        title=${cardsLabel}
        aria-label=${cardsLabel}
        aria-pressed=${!yaml && view === DashboardView.CARDS ? "true" : "false"}
        @click=${() => host._enterDeviceView(DashboardView.CARDS)}
      >
        <wa-icon library="mdi" name="view-grid"></wa-icon>
      </button>
      <button
        class="view-toggle-btn ${!yaml && view === DashboardView.TABLE ? "active" : ""}"
        type="button"
        title=${tableLabel}
        aria-label=${tableLabel}
        aria-pressed=${!yaml && view === DashboardView.TABLE ? "true" : "false"}
        @click=${() => host._enterDeviceView(DashboardView.TABLE)}
      >
        <wa-icon library="mdi" name="table"></wa-icon>
      </button>
      ${host._expertMode
        ? html`<button
            class="view-toggle-btn ${yaml ? "active" : ""}"
            type="button"
            title=${yamlLabel}
            aria-label=${yamlLabel}
            aria-pressed=${yaml ? "true" : "false"}
            @click=${() => host._setSearchMode(true)}
          >
            <wa-icon library="mdi" name="code-braces"></wa-icon>
          </button>`
        : nothing}
    </div>
  `;
}

export function renderSelectToggle(host: ESPHomePageDashboard): TemplateResult {
  const label = host._localize("dashboard.toggle_select_mode");
  return html`
    <button
      class="select-toggle-btn ${host._selectMode ? "active" : ""}"
      title=${label}
      aria-label=${label}
      aria-pressed=${host._selectMode}
      @click=${host._toggleSelectMode}
    >
      <wa-icon library="mdi" name="checkbox-multiple-marked-outline"></wa-icon>
      <span class="select-toggle-btn-label">${label}</span>
    </button>
  `;
}

export function renderSearchInput(host: ESPHomePageDashboard): TemplateResult {
  const placeholder = host._yamlMode
    ? host._localize("yaml_search.placeholder")
    : host._localize("dashboard.search_placeholder");
  // trim() to match _hasActiveFilters: a whitespace-only query filters
  // nothing, so don't offer to clear it.
  const hasQuery = host._search.trim().length > 0;
  // Decorative leading magnifier — the YAML-mode toggle lives as a
  // third option in the view-toggle radio group, not in here.
  return html`<div class="search-wrap">
    <wa-icon
      class="search-input-icon"
      library="mdi"
      name=${host._yamlMode ? "code-braces" : "magnify"}
      aria-hidden="true"
    ></wa-icon>
    <form
      role="search"
      autocomplete="off"
      class="search-form"
      @submit=${(e: SubmitEvent) => e.preventDefault()}
    >
      <input
        class="search-input ${host._yamlMode ? "search-input--yaml" : ""}"
        type="search"
        name="q"
        autocomplete="off"
        autocorrect="off"
        autocapitalize="off"
        spellcheck="false"
        aria-label=${placeholder}
        placeholder=${placeholder}
        .value=${host._search}
        @input=${(e: Event) => {
          host._search = (e.currentTarget as HTMLInputElement).value;
          host._syncYamlSearch();
        }}
        @keydown=${host._onSearchKeyDown}
      />
    </form>
    ${hasQuery
      ? html`<button
          class="search-clear"
          type="button"
          aria-label=${host._localize("dashboard.search_clear")}
          @click=${host._clearSearch}
        >
          <wa-icon library="mdi" name="close-circle" aria-hidden="true"></wa-icon>
        </button>`
      : nothing}
  </div>`;
}

/** Pairs the device-count with Select-multiple on one row. Used
 *  by both the card-view toolbar and the table-view toolbar so the
 *  toggle's position doesn't shift when the user flips the view. */
export function renderDeviceCountRow(
  host: ESPHomePageDashboard,
  matchCount: number,
  total: number
): TemplateResult {
  const q = host._search.trim();
  const unit = host._localize("dashboard.device_count", { count: matchCount });
  const suffix = q ? " " + host._localize("dashboard.search_of", { total }) : "";
  return html`
    <div class="device-count-row">
      <span class="device-count"><strong>${matchCount}</strong> ${unit}${suffix}</span>
      ${renderSelectToggle(host)}
    </div>
  `;
}

export function renderToolbar(
  host: ESPHomePageDashboard,
  matchCount: number,
  total: number
): TemplateResult {
  // Layout: [search] [view-toggle] [facets…]
  //         [X devices] [Select multiple]
  // Select-multiple sits paired with the device-count on its own
  // row — both reference the device list ("operate on these N
  // devices") so semantically they belong together, grouped at the
  // start under the search box. Frees the toolbar-row above for
  // filter-related controls only.
  return html`
    <div class="toolbar">
      <div class="toolbar-row">
        ${renderSearchInput(host)} ${renderViewToggle(host)} ${renderFacets(host)}
      </div>
      ${renderDeviceCountRow(host, matchCount, total)}
    </div>
  `;
}

export function renderYamlToolbar(host: ESPHomePageDashboard): TemplateResult {
  const hits = host._yamlSearch.hits;
  const matchCount =
    hits === null ? null : hits.reduce((sum, hit) => sum + hit.matches.length, 0);
  const unit = host._localize("yaml_search.match_count", { count: matchCount ?? 0 });
  return html`
    <div class="toolbar">
      <div class="toolbar-row">${renderSearchInput(host)} ${renderViewToggle(host)}</div>
      ${matchCount !== null
        ? html`<span class="device-count"><strong>${matchCount}</strong> ${unit}</span>`
        : ""}
    </div>
  `;
}

export function renderNoResultsExtras(host: ESPHomePageDashboard): TemplateResult {
  const hasSearch = host._search.trim().length > 0;

  return html`
    ${hasSearch && host._expertMode
      ? renderYamlPreviewPivot(host._localize, host._yamlPreviewCount, () =>
          host._setSearchMode(true)
        )
      : ""}
    <button class="empty-search-clear" @click=${host._clearAllFilters}>
      ${host._localize("dashboard.no_results_clear")}
    </button>
  `;
}

export function renderEmptySearch(host: ESPHomePageDashboard): TemplateResult {
  const q = host._search.trim();
  // Facet-only no-match needs different copy: "{query}" isn't
  // meaningful here, and the user reads the message to figure out
  // why the grid is empty — naming the cause directly beats
  // generic "no devices found".
  const desc = q
    ? host._localize("dashboard.no_results_desc", { query: q })
    : host._localize("dashboard.no_results_desc_filtered");
  return html`
    <div class="empty-search">
      <wa-icon class="empty-search-icon" library="mdi" name="magnify"></wa-icon>
      <h3 class="empty-search-title">${host._localize("dashboard.no_results_title")}</h3>
      <p class="empty-search-desc">${desc}</p>
      ${renderNoResultsExtras(host)}
    </div>
  `;
}

export function renderAddDeviceCard(host: ESPHomePageDashboard): TemplateResult {
  return html`
    <div class="add-device-card" @click=${() => host._createDialog.open()}>
      <div class="add-device-icon-wrap">
        <wa-icon library="mdi" name="plus"></wa-icon>
      </div>
      <span class="add-device-label">${host._localize("dashboard.add_new_device")}</span>
      <span class="add-device-hint"
        >${host._localize("dashboard.add_new_device_hint")}</span
      >
      <a
        class="esphome-web-link"
        href="https://web.esphome.io"
        target="_blank"
        rel="noopener"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <wa-icon library="mdi" name="web"></wa-icon> ${host._localize(
          "dashboard.esphome_web"
        )}
      </a>
    </div>
  `;
}

export function renderSelectBarOrFab(
  host: ESPHomePageDashboard
): TemplateResult | string {
  if (host._selectMode) {
    return html`
      <esphome-select-bar
        selected-count=${host._selectedDevices.size}
        ?all-visible-selected=${host._allVisibleSelected}
        @select-all=${() => host._addToSelection(host._currentlyVisibleConfigurations())}
        @deselect-all=${() =>
          host._removeFromSelection(host._currentlyVisibleConfigurations())}
        @cancel=${() => {
          host._selectMode = false;
          host._selectedDevices = new Set();
        }}
        @update-selected=${host._updateSelected}
        @archive-selected=${host._archiveSelected}
        @delete-selected=${host._deleteSelected}
        @labels-selected=${host._labelsSelected}
      ></esphome-select-bar>
    `;
  }
  if (host._view === DashboardView.CARDS) {
    return html`
      <div class="fab-container">
        <button class="fab-btn" @click=${() => host._createDialog.open()}>
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${host._localize("dashboard.create_device")}
        </button>
      </div>
    `;
  }
  return "";
}
