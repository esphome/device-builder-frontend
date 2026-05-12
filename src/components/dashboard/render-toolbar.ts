import { html, type TemplateResult } from "lit";
import { DashboardView, type Label } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { renderYamlPreviewPivot } from "./render-yaml.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";

export function renderViewToggle(host: ESPHomePageDashboard): TemplateResult {
  const view = host._view;
  const yaml = host._yamlMode;
  const cardsLabel = host._localize("dashboard.view_cards");
  const tableLabel = host._localize("dashboard.view_table");
  const yamlLabel = host._localize("yaml_search.switch_to_yaml");
  // Three mutually-exclusive view options: cards (default), table,
  // and YAML search (a list of device titles that expands to show
  // matching YAML snippets when the user types a query).
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
      <button
        class="view-toggle-btn ${yaml ? "active" : ""}"
        type="button"
        title=${yamlLabel}
        aria-label=${yamlLabel}
        aria-pressed=${yaml ? "true" : "false"}
        @click=${() => host._setSearchMode(true)}
      >
        <wa-icon library="mdi" name="code-braces"></wa-icon>
      </button>
    </div>
  `;
}

export function renderLabelsFilter(host: ESPHomePageDashboard): TemplateResult {
  return html`<esphome-labels-filter
    .selected=${host._selectedLabels}
    @labels-filter-change=${(e: CustomEvent<string[]>) => {
      host._selectedLabels = e.detail;
    }}
    @request-delete-label=${(e: CustomEvent<Label>) => {
      host._openConfirm({ kind: "delete-label", label: e.detail });
    }}
  ></esphome-labels-filter>`;
}

export function renderFilterGroup(host: ESPHomePageDashboard): TemplateResult {
  return html`
    <div class="filter-group">
      ${renderLabelsFilter(host)}
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
    </button>
  `;
}

export function renderSearchInput(host: ESPHomePageDashboard): TemplateResult {
  const placeholder = host._yamlMode
    ? host._localize("yaml_search.placeholder")
    : host._localize("dashboard.search_placeholder");
  // Decorative leading magnifier — the YAML-mode toggle lives as a
  // third option in the view-toggle radio group, not in here.
  return html`<div class="search-wrap">
    <wa-icon
      class="search-input-icon"
      library="mdi"
      name=${host._yamlMode ? "code-braces" : "magnify"}
      aria-hidden="true"
    ></wa-icon>
    <input
      class="search-input ${host._yamlMode ? "search-input--yaml" : ""}"
      type="search"
      with-clear
      autocomplete="off"
      placeholder=${placeholder}
      .value=${host._search}
      @input=${(e: Event) => {
        host._search = (e.currentTarget as HTMLInputElement).value;
        host._syncYamlSearch();
      }}
      @keydown=${host._onSearchKeyDown}
    />
  </div>`;
}

export function renderToolbar(
  host: ESPHomePageDashboard,
  matchCount: number,
  total: number,
): TemplateResult {
  const q = host._search.trim();
  const unit =
    matchCount === 1
      ? host._localize("dashboard.device_singular")
      : host._localize("dashboard.device_plural");
  const suffix = q ? " " + host._localize("dashboard.search_of", { total }) : "";
  return html`
    <div class="toolbar">
      <div class="toolbar-row">
        ${renderSearchInput(host)} ${renderViewToggle(host)}
        <span class="toolbar-spacer"></span>
        ${renderFilterGroup(host)} ${renderSelectToggle(host)}
      </div>
      <span class="device-count"><strong>${matchCount}</strong> ${unit}${suffix}</span>
    </div>
  `;
}

export function renderYamlToolbar(host: ESPHomePageDashboard): TemplateResult {
  const hits = host._yamlSearch.hits;
  const matchCount =
    hits === null
      ? null
      : hits.reduce((sum, hit) => sum + hit.matches.length, 0);
  const unit =
    matchCount === 1
      ? host._localize("yaml_search.match_count_singular")
      : host._localize("yaml_search.match_count_plural");
  return html`
    <div class="toolbar">
      <div class="toolbar-row">
        ${renderSearchInput(host)} ${renderViewToggle(host)}
        <span class="toolbar-spacer"></span>
        ${renderFilterGroup(host)}
      </div>
      ${matchCount !== null
        ? html`<span class="device-count"
            ><strong>${matchCount}</strong> ${unit}</span
          >`
        : ""}
    </div>
  `;
}

export function renderNoResultsExtras(host: ESPHomePageDashboard): TemplateResult {
  return html`
    ${renderYamlPreviewPivot(host._localize, host._yamlPreviewCount, () =>
      host._setSearchMode(true),
    )}
    <button
      class="empty-search-clear"
      @click=${() => {
        host._search = "";
      }}
    >
      ${host._localize("dashboard.no_results_clear")}
    </button>
  `;
}

export function renderEmptySearch(host: ESPHomePageDashboard): TemplateResult {
  return html`
    <div class="empty-search">
      <wa-icon class="empty-search-icon" library="mdi" name="magnify"></wa-icon>
      <h3 class="empty-search-title">
        ${host._localize("dashboard.no_results_title")}
      </h3>
      <p class="empty-search-desc">
        ${host._localize("dashboard.no_results_desc", { query: host._search.trim() })}
      </p>
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
      <span class="add-device-label"
        >${host._localize("dashboard.add_new_device")}</span
      >
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
          "dashboard.esphome_web",
        )}
      </a>
    </div>
  `;
}

export function renderSelectBarOrFab(
  host: ESPHomePageDashboard,
): TemplateResult | string {
  if (host._selectMode) {
    return html`
      <esphome-select-bar
        selected-count=${host._selectedDevices.size}
        ?all-visible-selected=${host._allVisibleSelected}
        @select-all=${() =>
          host._addToSelection(host._currentlyVisibleConfigurations())}
        @deselect-all=${() =>
          host._removeFromSelection(host._currentlyVisibleConfigurations())}
        @cancel=${() => {
          host._selectMode = false;
          host._selectedDevices = new Set();
        }}
        @update-selected=${host._updateSelected}
        @archive-selected=${host._archiveSelected}
        @delete-selected=${host._deleteSelected}
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
