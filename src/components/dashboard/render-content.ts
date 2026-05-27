import { html, type TemplateResult } from "lit";
import type { SortingState, VisibilityState } from "@tanstack/lit-table";
import type { AdoptableDevice, ConfiguredDevice } from "../../api/types.js";
import { downloadYaml, editDevice } from "./actions.js";
import {
  renderAddDeviceCard,
  renderFacets,
  renderNoResultsExtras,
  renderSearchInput,
  renderSelectToggle,
  renderViewToggle,
} from "./render-toolbar.js";
import { DEVICE_SORT_COLLATOR, deviceSortKey } from "../../util/device-sort.js";
import { buildWebUiUrl } from "../../util/web-ui-url.js";
import type { ESPHomePageDashboard } from "../../pages/dashboard.js";

export function renderDiscoveredSection(
  host: ESPHomePageDashboard
): TemplateResult | string {
  if (host._importableDevices.length === 0) return "";
  // Non-ignored discoveries first, then ignored ones — both
  // alphabetical by friendly name (fallback hostname) within each
  // group. Ignored cards are already dimmed via [data-ignored];
  // pushing them to the bottom keeps active discoveries on top.
  const visible = [...host._visibleImportableDevices].sort((a, b) => {
    if (a.ignored !== b.ignored) return a.ignored ? 1 : -1;
    return DEVICE_SORT_COLLATOR.compare(deviceSortKey(a), deviceSortKey(b));
  });
  // Nothing to announce when every importable is ignored and the
  // user has opted to hide them — the header kebab's "Show ignored
  // discoveries" entry is the path back, not a "Discovered 0
  // devices" stub.
  if (visible.length === 0) return "";
  const ignoredCount = host._importableDevices.filter((d) => d.ignored).length;
  const expanded = host._showDiscovered;
  return html`
    <section class="discovered-section">
      <header class="discovered-section-header">
        <wa-icon library="mdi" name="clipboard-text-search-outline"></wa-icon>
        <span class="discovered-section-count"
          >${host._localize(
            visible.length === 1
              ? "dashboard.discovered_count_singular"
              : "dashboard.discovered_count_plural",
            { count: visible.length }
          )}</span
        >
        <button
          class="discovered-section-toggle"
          type="button"
          aria-expanded=${expanded}
          aria-controls="discovered-grid"
          @click=${() => {
            host._showDiscovered = !host._showDiscovered;
          }}
        >
          ${host._localize(expanded ? "dashboard.hide" : "dashboard.show")}
        </button>
        ${ignoredCount > 0
          ? html`<button
              class="discovered-section-toggle discovered-section-toggle--ignored"
              type="button"
              aria-pressed=${host._showIgnored}
              @click=${host._toggleShowIgnored}
            >
              ${host._showIgnored
                ? host._localize("dashboard.hide_ignored")
                : host._localize("dashboard.show_ignored", {
                    count: ignoredCount,
                  })}
            </button>`
          : ""}
      </header>
      <div id="discovered-grid" class="discovered-section-grid" ?hidden=${!expanded}>
        ${visible.map(
          (device: AdoptableDevice) => html`
            <esphome-discovered-device-card
              compact
              .device=${device}
              @adopt=${() => host._adoptDialog.open(device)}
              @toggle-ignore=${() => host._toggleIgnore(device)}
            ></esphome-discovered-device-card>
          `
        )}
      </div>
    </section>
  `;
}

export function renderCardGrid(
  host: ESPHomePageDashboard,
  filtered: ConfiguredDevice[]
): TemplateResult {
  return html`
    <div class="devices-grid devices-grid--configured">
      ${host._devices.length === 0 ? renderAddDeviceCard(host) : ""}
      ${filtered.map((device) => {
        const webUrl = buildWebUiUrl(device);
        return html`
          <esphome-device-card
            data-configuration=${device.configuration}
            .name=${device.friendly_name || device.name}
            .configuration=${device.configuration}
            .state=${device.state}
            .labelIds=${device.labels ?? []}
            ?has-pending-changes=${device.has_pending_changes === true}
            ?has-update-available=${device.update_available}
            ?api-enabled=${device.api_enabled === true}
            ?api-encrypted=${device.api_encrypted === true}
            .apiEncryptionActive=${device.api_encryption_active ?? null}
            ?busy=${host._activeJobs.has(device.configuration)}
            .activeJob=${host._activeJobs.get(device.configuration) ?? null}
            ?highlight=${host._recentlyAdopted === device.configuration}
            .recentJob=${host._recentJobs.get(device.configuration) ?? null}
            .webUrl=${webUrl}
            ?select-mode=${host._selectMode}
            ?selected=${host._selectedDevices.has(device.configuration)}
            @edit-device=${() => editDevice(device)}
            @install-device=${() => host._openInstallMethod(device)}
            @update-device=${() => host._openCommand(device, "install")}
            @open-logs=${() => host._openLogs(device)}
            @show-progress=${() => host._showJobProgress(device)}
            @card-click=${() => host._toggleDrawerForDevice(device)}
            @card-context-menu=${(e: CustomEvent) => {
              host._cardContextDevice = device;
              host._cardContextPosition = e.detail;
            }}
            @toggle-select=${() => host._toggleDevice(device.configuration)}
          ></esphome-device-card>
        `;
      })}
    </div>
    ${renderCardContextMenu(host)}
  `;
}

export function renderTable(host: ESPHomePageDashboard): TemplateResult {
  const filteredDevices = host._applyFacetFilters(host._devices);
  return html`
    <esphome-device-table
      .devices=${filteredDevices}
      .search=${host._search}
      .activeJobs=${host._activeJobs}
      .recentJobs=${host._recentJobs}
      .initialPageSize=${host._tablePageSize}
      .initialSorting=${host._tableSorting}
      .initialColumnVisibility=${host._tableColumnVisibility}
      ?select-mode=${host._selectMode}
      .selectedDevices=${host._selectedDevices}
      .highlightConfiguration=${host._recentlyAdopted}
      @table-sort-change=${(e: CustomEvent<SortingState>) => host._saveTablePreference(e)}
      @table-visibility-change=${(e: CustomEvent<VisibilityState>) =>
        host._saveTablePreference(e)}
      @table-page-size-change=${(e: CustomEvent<number>) => host._saveTablePreference(e)}
      @row-click=${(e: CustomEvent<ConfiguredDevice>) =>
        host._toggleDrawerForDevice(e.detail)}
      @show-progress=${(e: CustomEvent<ConfiguredDevice>) =>
        host._showJobProgress(e.detail)}
      @toggle-select=${(e: CustomEvent<string>) => host._toggleDevice(e.detail)}
      @select-all=${(e: CustomEvent<string[]>) => host._addToSelection(e.detail)}
      @deselect-all=${(e: CustomEvent<string[]>) => host._removeFromSelection(e.detail)}
      @edit-device=${(e: CustomEvent<ConfiguredDevice>) => editDevice(e.detail)}
      @update-device=${(e: CustomEvent<ConfiguredDevice>) =>
        host._openCommand(e.detail, "install")}
      @open-logs=${(e: CustomEvent<ConfiguredDevice>) => host._openLogs(e.detail)}
      @validate-device=${(e: CustomEvent<ConfiguredDevice>) =>
        host._openCommand(e.detail, "validate")}
      @install-device=${(e: CustomEvent<ConfiguredDevice>) =>
        host._openInstallMethod(e.detail)}
      @show-api-key=${(e: CustomEvent<ConfiguredDevice>) => host._showApiKey(e.detail)}
      @download-yaml=${(e: CustomEvent<ConfiguredDevice>) =>
        downloadYaml(e.detail, host._api, host._localize)}
      @rename-device=${(e: CustomEvent<ConfiguredDevice>) => host._openRename(e.detail)}
      @clone-device=${(e: CustomEvent<ConfiguredDevice>) => host._openClone(e.detail)}
      @edit-friendly-name=${(e: CustomEvent<ConfiguredDevice>) =>
        host._openFriendlyName(e.detail)}
      @clean-build=${(e: CustomEvent<ConfiguredDevice>) =>
        host._openCommand(e.detail, "clean")}
      @download-elf=${(e: CustomEvent<ConfiguredDevice>) =>
        host._downloadFirmware(e.detail)}
      @archive-device=${(e: CustomEvent<ConfiguredDevice>) =>
        host._confirmArchive(e.detail)}
      @delete-device=${(e: CustomEvent<ConfiguredDevice>) =>
        host._confirmDeleteSingle(e.detail)}
      @enter-select-mode=${(e: CustomEvent<string>) => host._onEnterSelectMode(e.detail)}
    >
      <div slot="toolbar" class="toolbar-stack">
        <div class="toolbar-row">
          ${renderSearchInput(host)} ${renderViewToggle(host)} ${renderFacets(host)}
        </div>
      </div>
      <div slot="before-columns">${renderSelectToggle(host)}</div>
      <button
        slot="actions"
        class="table-create-btn"
        @click=${() => host._createDialog.open()}
      >
        <wa-icon library="mdi" name="plus"></wa-icon>
        ${host._localize("dashboard.create_device")}
      </button>
      <div slot="no-results-extra" class="yaml-preview-banner">
        ${renderNoResultsExtras(host)}
      </div>
    </esphome-device-table>
  `;
}

export function renderDrawer(host: ESPHomePageDashboard): TemplateResult {
  return html`
    <esphome-device-drawer
      ?open=${host._drawerOpen}
      .device=${host._drawerDevice}
      ?busy=${host._drawerDevice
        ? host._activeJobs.has(host._drawerDevice.configuration)
        : false}
      @drawer-close=${() => {
        host._drawerOpen = false;
      }}
      @edit-device=${(e: CustomEvent) => {
        host._drawerOpen = false;
        editDevice(e.detail);
      }}
      @update-device=${(e: CustomEvent<ConfiguredDevice>) => {
        host._drawerOpen = false;
        host._openCommand(e.detail, "install");
      }}
      @install-device=${(e: CustomEvent<ConfiguredDevice>) => {
        host._drawerOpen = false;
        host._openInstallMethod(e.detail);
      }}
      @open-logs=${(e: CustomEvent) => {
        host._drawerOpen = false;
        host._openLogs(e.detail);
      }}
      @clean-build=${(e: CustomEvent<ConfiguredDevice>) => {
        host._drawerOpen = false;
        host._openCommand(e.detail, "clean");
      }}
    ></esphome-device-drawer>
  `;
}

export function renderCardContextMenu(host: ESPHomePageDashboard): TemplateResult {
  return html`
    <esphome-table-row-menu
      .device=${host._cardContextDevice}
      .position=${host._cardContextPosition}
      card-mode
      ?busy=${host._cardContextDevice
        ? host._activeJobs.has(host._cardContextDevice.configuration)
        : false}
      @menu-close=${() => {
        host._cardContextDevice = null;
        host._cardContextPosition = null;
      }}
      @edit-device=${(e: CustomEvent<ConfiguredDevice>) => editDevice(e.detail)}
      @update-device=${(e: CustomEvent<ConfiguredDevice>) =>
        host._openCommand(e.detail, "install")}
      @open-logs=${(e: CustomEvent<ConfiguredDevice>) => host._openLogs(e.detail)}
      @validate-device=${(e: CustomEvent<ConfiguredDevice>) =>
        host._openCommand(e.detail, "validate")}
      @install-device=${(e: CustomEvent<ConfiguredDevice>) =>
        host._openInstallMethod(e.detail)}
      @show-api-key=${(e: CustomEvent<ConfiguredDevice>) => host._showApiKey(e.detail)}
      @download-yaml=${(e: CustomEvent<ConfiguredDevice>) =>
        downloadYaml(e.detail, host._api, host._localize)}
      @rename-device=${(e: CustomEvent<ConfiguredDevice>) => host._openRename(e.detail)}
      @clone-device=${(e: CustomEvent<ConfiguredDevice>) => host._openClone(e.detail)}
      @edit-friendly-name=${(e: CustomEvent<ConfiguredDevice>) =>
        host._openFriendlyName(e.detail)}
      @clean-build=${(e: CustomEvent<ConfiguredDevice>) =>
        host._openCommand(e.detail, "clean")}
      @download-elf=${(e: CustomEvent<ConfiguredDevice>) =>
        host._downloadFirmware(e.detail)}
      @archive-device=${(e: CustomEvent<ConfiguredDevice>) =>
        host._confirmArchive(e.detail)}
      @delete-device=${(e: CustomEvent<ConfiguredDevice>) =>
        host._confirmDeleteSingle(e.detail)}
      @enter-select=${(e: CustomEvent<ConfiguredDevice>) =>
        host._onEnterSelectMode(e.detail.configuration)}
    ></esphome-table-row-menu>
  `;
}
