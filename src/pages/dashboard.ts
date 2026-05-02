import { consume } from "@lit/context";
import {
  mdiCheckboxMultipleMarkedOutline,
  mdiClipboardTextSearchOutline,
  mdiMagnify,
  mdiPlus,
  mdiTable,
  mdiViewGrid,
  mdiWeb,
} from "@mdi/js";
import { LitElement, html, type PropertyValues } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/index.js";
import { DashboardView, DeviceState, SortDirection } from "../api/types.js";
import type { AdoptableDevice, ConfiguredDevice, FirmwareJob } from "../api/types.js";
import type { SortingState, VisibilityState } from "@tanstack/lit-table";
import type { LocalizeFunc } from "../common/localize.js";
import {
  activeJobsContext,
  apiContext,
  devicesContext,
  devicesLoadedContext,
  importableDevicesContext,
  localizeContext,
  recentJobsContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { firmwareJobDisplayName } from "../util/firmware-job-display.js";
import { registerMdiIcons } from "../util/register-icons.js";
import {
  deleteBulkDevices,
  deleteDevice,
  downloadYaml,
  editDevice,
  fetchApiKey,
  streamSerialToDialog,
} from "./dashboard-actions.js";
import { buildWebUiUrl } from "../util/web-ui-url.js";
import { detectChip, disconnect } from "../util/web-serial.js";
import { cardSkeletonTemplate, tableSkeletonTemplate } from "./dashboard-skeletons.js";
import { dashboardStyles } from "./dashboard-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/input/input.js";
import "../components/api-key-dialog.js";
import type { ESPHomeApiKeyDialog } from "../components/api-key-dialog.js";
import "../components/confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "../components/confirm-dialog.js";
import "../components/dashboard/device-drawer.js";
import "../components/dashboard/device-table.js";
import "../components/dashboard/table-row-menu.js";
import "../components/device-card.js";
import "../components/logs-dialog.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import "../components/firmware-install-dialog.js";
import type { ESPHomeFirmwareInstallDialog } from "../components/firmware-install-dialog.js";
import "../components/install-method-dialog.js";
import "../components/rename-device-dialog.js";
import type { ESPHomeRenameDeviceDialog } from "../components/rename-device-dialog.js";
import "../components/discovered-device-card.js";
import "../components/adopt-dialog.js";
import type { ESPHomeAdoptDialog } from "../components/adopt-dialog.js";
import "../components/select-bar.js";
import "../components/command-dialog.js";
import type { ESPHomeCommandDialog } from "../components/command-dialog.js";
import type { CommandType } from "../components/command-dialog.js";
import "../components/wizard/create-config-dialog.js";
import type { ESPHomeCreateConfigDialog } from "../components/wizard/create-config-dialog.js";

registerMdiIcons({
  "checkbox-multiple-marked-outline": mdiCheckboxMultipleMarkedOutline,
  "clipboard-text-search-outline": mdiClipboardTextSearchOutline,
  magnify: mdiMagnify,
  plus: mdiPlus,
  "view-grid": mdiViewGrid,
  table: mdiTable,
  web: mdiWeb,
});

@customElement("esphome-page-dashboard")
export class ESPHomePageDashboard extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: devicesContext, subscribe: true })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @consume({ context: importableDevicesContext, subscribe: true })
  @state()
  private _importableDevices: AdoptableDevice[] = [];

  @consume({ context: devicesLoadedContext, subscribe: true })
  @state()
  private _devicesLoaded = false;

  @consume({ context: activeJobsContext, subscribe: true })
  @state()
  private _activeJobs: Map<string, FirmwareJob> = new Map();

  @consume({ context: recentJobsContext, subscribe: true })
  @state()
  private _recentJobs: Map<string, FirmwareJob> = new Map();

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state() private _showDiscovered = false;
  @state() private _search = "";
  @state() private _installMethodOpen = false;
  @state() private _installMethodDevice: ConfiguredDevice | null = null;
  @state() private _installMethodMode: "install" | "logs" = "install";
  @state() private _selectMode = false;
  @state() private _selectedDevices = new Set<string>();
  @state() private _drawerOpen = false;
  @state() private _drawerDevice: ConfiguredDevice | null = null;
  @state() private _cardContextDevice: ConfiguredDevice | null = null;
  @state() private _cardContextPosition: { x: number; y: number } | null = null;
  /** Single device queued for delete confirmation. ``null`` means
   *  the shared confirm dialog is in bulk-delete mode (driven by
   *  ``_selectedDevices``). The state-keyed mode-switch lets us
   *  reuse one ``esphome-confirm-dialog`` instance for both the
   *  per-device kebab Delete and the select-mode bulk Delete
   *  without juggling two dialog elements. */
  @state() private _pendingDelete: ConfiguredDevice | null = null;
  /** Configuration filename of the most recently adopted device.
   *  Drives a short-lived ``highlight`` attribute on the matching
   *  device card / row so the user can spot the freshly-imported
   *  device in a long list. Cleared by ``_adoptHighlightTimer``. */
  @state() private _recentlyAdopted: string | null = null;
  private _adoptHighlightTimer: ReturnType<typeof setTimeout> | null = null;

  /* The card view has no user-facing sort control, so we sort the
     device list ourselves: friendly-name first, configuration-filename
     fallback. Locale-aware via ``Intl.Collator`` with
     ``sensitivity: base`` (case-insensitive) plus ``numeric: true``
     (so ``device-2`` sorts before ``device-10``). Built once here
     rather than each render so re-renders triggered by unrelated
     state (jobs, search, recent jobs) don't pay the construction
     cost. ``Intl.Collator`` already handles case-folding, so the
     sort key passes the raw string instead of pre-lower-casing
     (which can be wrong in some locales — Turkish dotted-i, etc.). */
  private static readonly _cardCollator = new Intl.Collator(undefined, {
    sensitivity: "base",
    numeric: true,
  });
  private _sortedDevicesCache: {
    source: ConfiguredDevice[];
    sorted: ConfiguredDevice[];
  } | null = null;
  /** When false (default), discovered devices the user previously
   *  marked as Ignored are hidden from the banner and grid; the
   *  ``Show ignored discoveries`` toggle in the header kebab flips
   *  this to ``true``. Persisted to localStorage so the choice
   *  survives reloads. */
  @state() private _showIgnored = false;

  @state()
  private _view: DashboardView = DashboardView.CARDS;

  // Table preferences — synced to/from backend
  @state() private _tablePageSize = 25;
  @state() private _tableSorting: SortingState | null = null;
  @state() private _tableColumnVisibility: VisibilityState | null = null;

  private _onEnterSelectMode = (configuration?: string) => {
    this._selectMode = true;
    this._selectedDevices = configuration ? new Set([configuration]) : new Set();
  };

  protected willUpdate(changed: PropertyValues) {
    if (changed.has("_view")) {
      this.setAttribute("view", this._view);
    }
    // Load preferences once WS is connected (devices loaded means events are flowing)
    if (changed.has("_devicesLoaded") && this._devicesLoaded) {
      this._loadPreferences();
    }
  }

  private _onSerialSetup = () => this._detectAndOpenWizard();
  private _onShowIgnoredChanged = (e: Event) => {
    this._showIgnored = (e as CustomEvent<{ value: boolean }>).detail.value;
  };

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute("view", this._view);
    /* The "Show ignored discoveries" toggle lives in the header
       kebab; sync the persisted flag here and listen for changes
       dispatched from the menu so we don't have to thread props /
       contexts through the layout. */
    this._showIgnored = localStorage.getItem("esphome-show-ignored") === "true";
    window.addEventListener("esphome-serial-setup", this._onSerialSetup);
    window.addEventListener(
      "esphome-show-ignored-changed",
      this._onShowIgnoredChanged,
    );
  }

  private async _loadPreferences() {
    try {
      const prefs = await this._api.getPreferences();
      this._view = prefs.dashboard_view;
      this._tablePageSize = prefs.table_page_size;
      this._tableColumnVisibility = prefs.table_column_visibility;

      // Convert backend sort (column + direction) to TanStack SortingState
      if (prefs.table_sort_column) {
        this._tableSorting = [
          { id: prefs.table_sort_column, desc: prefs.table_sort_direction === SortDirection.DESC },
        ];
      } else {
        this._tableSorting = [];
      }
    } catch {
      // Preferences not critical — use default
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("esphome-serial-setup", this._onSerialSetup);
    window.removeEventListener(
      "esphome-show-ignored-changed",
      this._onShowIgnoredChanged,
    );
    if (this._adoptHighlightTimer !== null) {
      clearTimeout(this._adoptHighlightTimer);
      this._adoptHighlightTimer = null;
    }
  }

  @query("esphome-api-key-dialog") private _apiKeyDialog!: ESPHomeApiKeyDialog;
  @query("esphome-confirm-dialog") private _confirmDialog!: ESPHomeConfirmDialog;
  @query("esphome-create-config-dialog") private _createDialog!: ESPHomeCreateConfigDialog;
  @query("esphome-rename-device-dialog") private _renameDialog!: ESPHomeRenameDeviceDialog;
  @query("esphome-adopt-dialog") private _adoptDialog!: ESPHomeAdoptDialog;
  @query("esphome-command-dialog") private _commandDialog!: ESPHomeCommandDialog;
  @query("esphome-firmware-install-dialog") private _firmwareDialog!: ESPHomeFirmwareInstallDialog;
  @query("esphome-logs-dialog") private _logsDialog!: ESPHomeLogsDialog;

  /** Device currently targeted by rename/api-key actions. */
  private _actionDevice: ConfiguredDevice | null = null;

  static styles = [espHomeStyles, dashboardStyles];

  protected render() {
    if (!this._devicesLoaded) {
      return this._view === DashboardView.TABLE ? tableSkeletonTemplate : cardSkeletonTemplate;
    }

    const q = this._search.trim().toLowerCase();
    const sorted = this._sortedDevices;
    const filtered = q
      ? sorted.filter(
          (d) =>
            (d.friendly_name || d.name).toLowerCase().includes(q) ||
            d.configuration.toLowerCase().includes(q),
        )
      : sorted;

    return html`
      ${this._renderBanner()}
      ${this._renderDiscoveredGrid()}
      ${this._devices.length > 0 && this._view === DashboardView.CARDS
        ? this._renderToolbar(filtered.length, this._devices.length)
        : ""}
      ${filtered.length === 0 && q && this._view === DashboardView.CARDS ? this._renderEmptySearch() : ""}
      ${this._view === DashboardView.CARDS ? this._renderCardGrid(filtered) : this._renderTable()}
      ${this._renderDrawer()}
      ${this._renderSelectBarOrFab()}
      ${this._renderDialogs()}
    `;
  }

  /** Cached, sorted view of ``_devices``. Cache key is the array
   *  reference, which is replaced (not mutated) by every WS event
   *  in app-shell, so an event that doesn't touch the device list
   *  reuses the previous sort verbatim. */
  private get _sortedDevices(): ConfiguredDevice[] {
    const source = this._devices;
    if (this._sortedDevicesCache?.source === source) {
      return this._sortedDevicesCache.sorted;
    }
    const collator = ESPHomePageDashboard._cardCollator;
    const sortKey = (d: ConfiguredDevice) =>
      d.friendly_name || d.name || d.configuration;
    const sorted = [...source].sort((a, b) =>
      collator.compare(sortKey(a), sortKey(b)),
    );
    this._sortedDevicesCache = { source, sorted };
    return sorted;
  }

  private get _visibleImportableDevices(): AdoptableDevice[] {
    /* Hide ignored discoveries by default — the user already said
       "don't show me this", so a fresh page load shouldn't put them
       back in front. The header kebab's "Show ignored discoveries"
       toggle flips ``_showIgnored`` to surface them again. */
    return this._showIgnored
      ? this._importableDevices
      : this._importableDevices.filter((d) => !d.ignored);
  }

  private _renderDiscoveredGrid() {
    const visible = this._visibleImportableDevices;
    /* Always render the container — the banner toggle's
       ``aria-controls="discovered-grid"`` points here, and assistive
       tech expects the referenced element to exist in the DOM whether
       or not it's currently visible. ``hidden`` toggles display via
       the user agent and is exposed to AT correctly. The empty-grid
       case (no visible discoveries) also renders an empty container
       so the reference stays valid. */
    return html`
      <div
        id="discovered-grid"
        class="devices-grid"
        ?hidden=${!this._showDiscovered || visible.length === 0}
      >
        ${visible.map(
          (device) => html`
            <esphome-discovered-device-card
              .device=${device}
              @adopt=${() => this._adoptDialog.open(device)}
              @toggle-ignore=${() => this._toggleIgnore(device)}
            ></esphome-discovered-device-card>
          `,
        )}
      </div>
    `;
  }

  // ─── Render helpers ───

  private _renderBanner() {
    /* Banner counts only what's visible — when every discovery is
       ignored (and "Show ignored" is off) the banner disappears
       entirely. The user can still bring them back via the header
       menu, but they shouldn't see a "Discovered N" prompt for
       devices they already chose to dismiss. */
    const visible = this._visibleImportableDevices;
    if (visible.length === 0) return "";
    return html`
      <div class="discovered-banner-wrap">
        <div class="discovered-banner">
          <div class="discovered-banner-empty"></div>
          <div style="justify-content: center; display: flex; align-items: center">
            <wa-icon library="mdi" name="clipboard-text-search-outline"></wa-icon>
            <span>${this._localize("dashboard.discovered_count", { count: visible.length })}</span>
          </div>
          <button
            class="discovered-banner-toggle"
            type="button"
            aria-expanded=${this._showDiscovered}
            aria-controls="discovered-grid"
            @click=${() => { this._showDiscovered = !this._showDiscovered; }}
          >${this._localize(this._showDiscovered ? "dashboard.hide" : "dashboard.show")}</button>
        </div>
      </div>
    `;
  }

  private _renderViewToggle() {
    const view = this._view;
    return html`
      <div class="view-toggle">
        <button class="view-toggle-btn ${view === DashboardView.CARDS ? "active" : ""}" @click=${() => this._setView(DashboardView.CARDS)}>
          <wa-icon library="mdi" name="view-grid"></wa-icon>
        </button>
        <button class="view-toggle-btn ${view === DashboardView.TABLE ? "active" : ""}" @click=${() => this._setView(DashboardView.TABLE)}>
          <wa-icon library="mdi" name="table"></wa-icon>
        </button>
      </div>
    `;
  }

  private _renderSelectToggle() {
    const label = this._localize("dashboard.toggle_select_mode");
    return html`
      <button
        class="select-toggle-btn ${this._selectMode ? "active" : ""}"
        title=${label}
        aria-label=${label}
        aria-pressed=${this._selectMode}
        @click=${this._toggleSelectMode}
      >
        <wa-icon library="mdi" name="checkbox-multiple-marked-outline"></wa-icon>
      </button>
    `;
  }

  private _toggleSelectMode = () => {
    if (this._selectMode) {
      this._selectMode = false;
      this._selectedDevices = new Set();
    } else {
      this._selectMode = true;
    }
  };

  private _renderSearchInput() {
    // ``wa-input`` carries a built-in cross-browser clear button via
    // ``with-clear`` — no need to hand-roll one or work around
    // Firefox not rendering ``::-webkit-search-cancel-button``.
    return html`<div class="search-wrap">
      <wa-input
        class="search-input"
        type="search"
        with-clear
        placeholder=${this._localize("dashboard.search_placeholder")}
        .value=${this._search}
        @input=${(e: Event) => {
          // ``e.target`` is the ``<wa-input>`` custom-element host,
          // not the inner native input — read from ``currentTarget``
          // typed as the ``{ value }`` shape we actually rely on
          // rather than casting to HTMLInputElement (which it isn't).
          this._search = (e.currentTarget as unknown as { value: string }).value;
        }}
      >
        <wa-icon slot="start" library="mdi" name="magnify"></wa-icon>
      </wa-input>
    </div>`;
  }

  private _renderToolbar(matchCount: number, total: number) {
    const q = this._search.trim();
    const unit = matchCount === 1 ? this._localize("dashboard.device_singular") : this._localize("dashboard.device_plural");
    const suffix = q ? " " + this._localize("dashboard.search_of", { total }) : "";
    return html`
      <div class="toolbar">
        <div class="toolbar-row">
          ${this._renderSearchInput()}
          ${this._renderSelectToggle()}
          ${this._renderViewToggle()}
        </div>
        <span class="device-count"><strong>${matchCount}</strong> ${unit}${suffix}</span>
      </div>
    `;
  }

  private _renderEmptySearch() {
    return html`
      <div class="empty-search">
        <wa-icon class="empty-search-icon" library="mdi" name="magnify"></wa-icon>
        <h3 class="empty-search-title">${this._localize("dashboard.no_results_title")}</h3>
        <p class="empty-search-desc">${this._localize("dashboard.no_results_desc", { query: this._search.trim() })}</p>
        <button class="empty-search-clear" @click=${() => { this._search = ""; }}>${this._localize("dashboard.no_results_clear")}</button>
      </div>
    `;
  }

  private _renderCardGrid(filtered: ConfiguredDevice[]) {
    return html`
      <div class="devices-grid devices-grid--configured">
        ${this._devices.length === 0 ? this._renderAddDeviceCard() : ""}
        ${filtered.map((device) => {
          const webUrl = buildWebUiUrl(device);
          return html`
            <esphome-device-card
              data-configuration=${device.configuration}
              .name=${device.friendly_name || device.name}
              .configuration=${device.configuration}
              .state=${device.state}
              ?has-pending-changes=${device.has_pending_changes === true}
              ?has-update-available=${device.update_available}
              ?api-enabled=${device.api_enabled === true}
              ?api-encrypted=${device.api_encrypted === true}
              .apiEncryptionActive=${device.api_encryption_active ?? null}
              ?busy=${this._activeJobs.has(device.configuration)}
              .activeJob=${this._activeJobs.get(device.configuration) ?? null}
              ?highlight=${this._recentlyAdopted === device.configuration}
              .recentJob=${this._recentJobs.get(device.configuration) ?? null}
              .webUrl=${webUrl}
              ?select-mode=${this._selectMode}
              ?selected=${this._selectedDevices.has(device.configuration)}
              @edit-device=${() => editDevice(device)}
              @install-device=${() => this._openInstallMethod(device)}
              @update-device=${() => this._openCommand(device, "install")}
              @open-logs=${() => this._openLogs(device)}
              @show-progress=${() => this._showJobProgress(device)}
              @card-click=${() => this._toggleDrawerForDevice(device)}
              @card-context-menu=${(e: CustomEvent) => { this._cardContextDevice = device; this._cardContextPosition = e.detail; }}
              @toggle-select=${() => this._toggleDevice(device.configuration)}
            ></esphome-device-card>
          `;
        })}
      </div>
      ${this._renderCardContextMenu()}
    `;
  }

  private _renderTable() {
    return html`
      <esphome-device-table
        .devices=${this._devices}
        .search=${this._search}
        .activeJobs=${this._activeJobs}
        .recentJobs=${this._recentJobs}
        .initialPageSize=${this._tablePageSize}
        .initialSorting=${this._tableSorting}
        .initialColumnVisibility=${this._tableColumnVisibility}
        ?select-mode=${this._selectMode}
        .selectedDevices=${this._selectedDevices}
        .highlightConfiguration=${this._recentlyAdopted}
        @table-sort-change=${this._saveTablePreference}
        @table-visibility-change=${this._saveTablePreference}
        @table-page-size-change=${this._saveTablePreference}
        @row-click=${(e: CustomEvent<ConfiguredDevice>) => this._toggleDrawerForDevice(e.detail)}
        @show-progress=${(e: CustomEvent<ConfiguredDevice>) => this._showJobProgress(e.detail)}
        @toggle-select=${(e: CustomEvent<string>) => this._toggleDevice(e.detail)}
        @select-all=${() => { this._selectedDevices = new Set(this._devices.map((d) => d.configuration)); }}
        @deselect-all=${() => { this._selectedDevices = new Set(); }}
        @edit-device=${(e: CustomEvent<ConfiguredDevice>) => editDevice(e.detail)}
        @update-device=${(e: CustomEvent<ConfiguredDevice>) => this._openCommand(e.detail, "install")}
        @open-logs=${(e: CustomEvent<ConfiguredDevice>) => this._openLogs(e.detail)}
        @validate-device=${(e: CustomEvent<ConfiguredDevice>) => this._openCommand(e.detail, "validate")}
        @install-device=${(e: CustomEvent<ConfiguredDevice>) => this._openInstallMethod(e.detail)}
        @show-api-key=${(e: CustomEvent<ConfiguredDevice>) => this._showApiKey(e.detail)}
        @download-yaml=${(e: CustomEvent<ConfiguredDevice>) => downloadYaml(e.detail, this._api, this._localize)}
        @rename-device=${(e: CustomEvent<ConfiguredDevice>) => this._openRename(e.detail)}
        @clean-build=${(e: CustomEvent<ConfiguredDevice>) => this._openCommand(e.detail, "clean")}
        @download-elf=${(e: CustomEvent<ConfiguredDevice>) => this._downloadFirmware(e.detail)}
        @delete-device=${(e: CustomEvent<ConfiguredDevice>) => this._confirmDeleteSingle(e.detail)}
        @enter-select-mode=${(e: CustomEvent<string>) => this._onEnterSelectMode(e.detail)}
      >
        <div slot="toolbar" class="toolbar-row">
          ${this._renderSearchInput()}
          ${this._renderSelectToggle()}
          ${this._renderViewToggle()}
        </div>
        <button slot="actions" class="table-create-btn" @click=${() => this._createDialog.open()}>
          <wa-icon library="mdi" name="plus"></wa-icon>
          ${this._localize("dashboard.create_device")}
        </button>
      </esphome-device-table>
    `;
  }

  private _renderDrawer() {
    return html`
      <esphome-device-drawer
        ?open=${this._drawerOpen}
        .device=${this._drawerDevice}
        ?busy=${this._drawerDevice ? this._activeJobs.has(this._drawerDevice.configuration) : false}
        @drawer-close=${() => { this._drawerOpen = false; }}
        @edit-device=${(e: CustomEvent) => { this._drawerOpen = false; editDevice(e.detail); }}
        @update-device=${(e: CustomEvent<ConfiguredDevice>) => { this._drawerOpen = false; this._openCommand(e.detail, "install"); }}
        @install-device=${(e: CustomEvent<ConfiguredDevice>) => { this._drawerOpen = false; this._openInstallMethod(e.detail); }}
        @open-logs=${(e: CustomEvent) => { this._drawerOpen = false; this._openLogs(e.detail); }}
      ></esphome-device-drawer>
    `;
  }

  private _renderCardContextMenu() {
    return html`
      <esphome-table-row-menu
        .device=${this._cardContextDevice}
        .position=${this._cardContextPosition}
        card-mode
        ?has-pending=${this._cardContextDevice?.has_pending_changes === true}
        ?has-update=${this._cardContextDevice?.update_available === true}
        ?busy=${this._cardContextDevice ? this._activeJobs.has(this._cardContextDevice.configuration) : false}
        @menu-close=${() => { this._cardContextDevice = null; this._cardContextPosition = null; }}
        @edit-device=${(e: CustomEvent<ConfiguredDevice>) => editDevice(e.detail)}
        @update-device=${(e: CustomEvent<ConfiguredDevice>) => this._openCommand(e.detail, "install")}
        @open-logs=${(e: CustomEvent<ConfiguredDevice>) => this._openLogs(e.detail)}
        @validate-device=${(e: CustomEvent<ConfiguredDevice>) => this._openCommand(e.detail, "validate")}
        @install-device=${(e: CustomEvent<ConfiguredDevice>) => this._openInstallMethod(e.detail)}
        @show-api-key=${(e: CustomEvent<ConfiguredDevice>) => this._showApiKey(e.detail)}
        @download-yaml=${(e: CustomEvent<ConfiguredDevice>) => downloadYaml(e.detail, this._api, this._localize)}
        @rename-device=${(e: CustomEvent<ConfiguredDevice>) => this._openRename(e.detail)}
        @clean-build=${(e: CustomEvent<ConfiguredDevice>) => this._openCommand(e.detail, "clean")}
        @download-elf=${(e: CustomEvent<ConfiguredDevice>) => this._downloadFirmware(e.detail)}
        @delete-device=${(e: CustomEvent<ConfiguredDevice>) => this._confirmDeleteSingle(e.detail)}
        @enter-select=${(e: CustomEvent<ConfiguredDevice>) => this._onEnterSelectMode(e.detail.configuration)}
      ></esphome-table-row-menu>
    `;
  }

  private _renderSelectBarOrFab() {
    if (this._selectMode) {
      return html`
        <esphome-select-bar
          selected-count=${this._selectedDevices.size}
          total-count=${this._devices.length}
          @select-all=${() => { this._selectedDevices = new Set(this._devices.map((d) => d.configuration)); }}
          @deselect-all=${() => { this._selectedDevices = new Set(); }}
          @cancel=${() => { this._selectMode = false; this._selectedDevices = new Set(); }}
          @update-selected=${this._updateSelected}
          @delete-selected=${this._deleteSelected}
        ></esphome-select-bar>
      `;
    }
    if (this._view === DashboardView.CARDS) {
      return html`
        <div class="fab-container">
          <button class="fab-btn" @click=${() => this._createDialog.open()}>
            <wa-icon library="mdi" name="plus"></wa-icon>
            ${this._localize("dashboard.create_device")}
          </button>
        </div>
      `;
    }
    return "";
  }

  private _renderDialogs() {
    /* One confirm-dialog instance covers both flows (per-device
       kebab Delete and select-mode bulk Delete) — ``_pendingDelete``
       drives the copy and the ``@confirm`` router. Picking up the
       device's friendly name keeps the prompt readable when the
       technical hostname is something like
       ``athom-rgbcw-bulb-998181``. */
    const pendingName = this._pendingDelete
      ? this._pendingDelete.friendly_name || this._pendingDelete.name
      : "";
    return html`
      <esphome-confirm-dialog
        heading=${this._pendingDelete
          ? this._localize("dashboard.delete_single_title")
          : this._localize("dashboard.delete_selected_title")}
        message=${this._pendingDelete
          ? this._localize("dashboard.delete_single_desc", { name: pendingName })
          : this._localize("dashboard.delete_selected_desc", { count: this._selectedDevices.size })}
        confirm-label=${this._localize("dashboard.delete_selected_confirm")}
        destructive
        @confirm=${this._executeDelete}
        @cancel=${() => { this._pendingDelete = null; }}
      ></esphome-confirm-dialog>
      <esphome-rename-device-dialog
        @rename-confirm=${this._executeRename}
      ></esphome-rename-device-dialog>
      <esphome-adopt-dialog @adopted=${this._onAdopted}></esphome-adopt-dialog>
      <esphome-api-key-dialog></esphome-api-key-dialog>
      <esphome-create-config-dialog></esphome-create-config-dialog>
      <esphome-command-dialog></esphome-command-dialog>
      <esphome-firmware-install-dialog></esphome-firmware-install-dialog>
      <esphome-logs-dialog></esphome-logs-dialog>
      <esphome-install-method-dialog
        ?open=${this._installMethodOpen}
        .deviceState=${this._installMethodDevice?.state ?? DeviceState.UNKNOWN}
        .mode=${this._installMethodMode}
        @close=${() => { this._installMethodOpen = false; }}
        @select-method=${this._onInstallMethodSelect}
      ></esphome-install-method-dialog>
    `;
  }

  private _renderAddDeviceCard() {
    return html`
      <div class="add-device-card" @click=${() => this._createDialog.open()}>
        <div class="add-device-icon-wrap"><wa-icon library="mdi" name="plus"></wa-icon></div>
        <span class="add-device-label">${this._localize("dashboard.add_new_device")}</span>
        <span class="add-device-hint">${this._localize("dashboard.add_new_device_hint")}</span>
        <a class="esphome-web-link" href="https://web.esphome.io" target="_blank" rel="noopener" @click=${(e: Event) => e.stopPropagation()}>
          <wa-icon library="mdi" name="web"></wa-icon> ${this._localize("dashboard.esphome_web")}
        </a>
      </div>
    `;
  }

  // ─── Actions ───

  private async _toggleIgnore(device: AdoptableDevice) {
    /* Surface failures so a stuck UI (ignored badge that didn't flip)
       has an explanation. The frontend's optimistic update isn't
       used here — we wait for the backend's IMPORTABLE_DEVICE_ADDED
       re-fire — so a failed call just leaves the card in its prior
       state, which is fine. */
    try {
      await this._api.ignoreDevice(device.name, !device.ignored);
    } catch {
      const name = device.friendly_name || device.name;
      toast.error(
        this._localize(
          device.ignored
            ? "dashboard.action_unignore_failed"
            : "dashboard.action_ignore_failed",
          { name },
        ),
        { richColors: true },
      );
    }
  }

  private _onAdopted = (e: CustomEvent<{ name: string; friendlyName: string }>) => {
    /* Configuration filenames are ``<name>.yaml`` — that's how the
       adopt dialog asks the backend to write the file (see
       ``import_device``), so the filename is deterministic from the
       submitted name. Driving the highlight off the configuration
       string lets us light up either the card or the table row,
       both of which key on ``device.configuration``. */
    const configuration = `${e.detail.name}.yaml`;
    this._recentlyAdopted = configuration;
    /* Mark this configuration as scroll-pending. The actual scroll
       happens in ``updated()`` once the matching device shows up in
       ``_devices`` — the WS DEVICE_ADDED event lags the dialog's
       ``adopted`` event, especially on mobile where the round-trip
       is slower, so a scroll fired right now hits a layout that
       doesn't have the new card yet. */
    this._pendingAdoptScroll = configuration;
    if (this._adoptHighlightTimer !== null) {
      clearTimeout(this._adoptHighlightTimer);
    }
    this._adoptHighlightTimer = setTimeout(() => {
      this._recentlyAdopted = null;
      this._adoptHighlightTimer = null;
    }, 4000);
  };

  private _pendingAdoptScroll: string | null = null;

  protected updated(changed: PropertyValues): void {
    if (
      this._pendingAdoptScroll !== null &&
      changed.has("_devices") &&
      this._devices.some((d) => d.configuration === this._pendingAdoptScroll)
    ) {
      const target = this._pendingAdoptScroll;
      this._pendingAdoptScroll = null;
      /* Wait two animation frames before scrolling. On the render
         where the device first appears, the card's children
         (wa-icon, status badge, etc.) are still mounting and the
         row's height isn't final, so a same-tick ``scrollIntoView``
         calculates against a too-short layout and stops short. Two
         rAFs are enough for Lit's children to commit and for the
         browser to settle the grid track sizes. */
      requestAnimationFrame(() =>
        requestAnimationFrame(() => this._scrollAdoptedIntoView(target)),
      );
    }
  }

  private _scrollAdoptedIntoView(configuration: string): void {
    /* Card view: the card lives in this dashboard's shadow root.
       Table view: the row lives inside ``esphome-device-table``'s
       own shadow root; ask the table to scroll its match instead of
       trying to reach across the boundary.
       ``behavior: "instant"`` (rather than "smooth") avoids Chrome
       mobile's well-known bug where ``scrollIntoView`` aborts the
       smooth animation after one viewport-height of motion — the
       card highlight already gives the user transition feedback, so
       jumping straight to the right scroll position is the more
       reliable signal. */
    const root = this.shadowRoot;
    if (!root) return;
    const escaped = CSS.escape(configuration);
    const card = root.querySelector<HTMLElement>(
      `esphome-device-card[data-configuration="${escaped}"]`,
    );
    if (card) {
      card.scrollIntoView({ behavior: "instant", block: "center" });
      return;
    }
    const table = root.querySelector("esphome-device-table") as
      | (HTMLElement & {
          scrollConfigurationIntoView?: (configuration: string) => void;
        })
      | null;
    table?.scrollConfigurationIntoView?.(configuration);
  }

  private _setView(view: DashboardView) {
    this._view = view;
    this._api.updatePreferences({ dashboard_view: view }).catch(() => {});
  }

  private _saveTablePreference(e: CustomEvent) {
    const type = e.type;
    if (type === "table-sort-change") {
      const sorting = (e as CustomEvent<SortingState>).detail;
      const first = sorting[0] ?? null;
      this._api.updatePreferences({
        table_sort_column: first?.id ?? null,
        table_sort_direction: first ? (first.desc ? SortDirection.DESC : SortDirection.ASC) : null,
      }).catch(() => {});
    } else if (type === "table-visibility-change") {
      this._api.updatePreferences({ table_column_visibility: (e as CustomEvent<VisibilityState>).detail }).catch(() => {});
    } else if (type === "table-page-size-change") {
      this._api.updatePreferences({ table_page_size: (e as CustomEvent<number>).detail }).catch(() => {});
    }
  }

  private _openRename(device: ConfiguredDevice) {
    this._actionDevice = device;
    this._renameDialog.open(device.name);
  }

  private async _executeRename(e: CustomEvent<string>) {
    const device = this._actionDevice;
    if (!device) return;
    const newName = e.detail;
    if (newName === device.name) return;
    let response: Awaited<ReturnType<ESPHomeAPI["renameDevice"]>>;
    try {
      response = await this._api.renameDevice(device.configuration, newName);
    } catch {
      toast.error(this._localize("dashboard.action_rename_failed", { name: device.name }), { richColors: true });
      return;
    }
    if (response.job) {
      /* Validated configs route through the firmware queue — the
         compile + OTA install runs there and we follow it in the
         command-dialog so the user sees live output. The dialog
         shows a success/error banner on completion via the existing
         command.rename_* localized strings.
         Reuse ``firmwareJobDisplayName`` so the dialog title format
         stays in lockstep with what the firmware-tasks list shows
         when the user reopens this same job mid-flight. */
      this._commandDialog.followJob(
        response.job,
        firmwareJobDisplayName(response.job, this._devices, this._localize),
      );
      return;
    }
    /* No job: backend did a pure file-level rename inline (config
       didn't validate, nothing to flash). Show the success toast
       immediately. */
    toast.success(this._localize("dashboard.action_rename_success", { name: newName }), { richColors: true });
  }

  private async _showApiKey(device: ConfiguredDevice) {
    const key = await fetchApiKey(device, this._api);
    this._apiKeyDialog.open(key);
  }

  private async _downloadFirmware(device: ConfiguredDevice) {
    const name = device.friendly_name || device.name;
    try {
      const binaries = await this._api.firmwareGetBinaries(device.configuration);
      if (binaries.length === 0) {
        toast.error(this._localize("dashboard.download_no_binaries", { name }), { richColors: true });
        return;
      }
      const binary = binaries[0];
      const result = await this._api.firmwareDownload(device.configuration, binary.file);
      const bytes = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(this._localize("dashboard.download_firmware_failed", { name }), { richColors: true });
    }
  }

  private async _detectAndOpenWizard() {
    try {
      const detected = await detectChip();
      const chipName = detected.chipName;
      await disconnect(detected.transport);

      const family = chipName.split("(")[0].trim().toLowerCase().replace(/-/g, "");
      const board = await this._api.getBoard(`generic-${family}`);

      if (board) {
        this._createDialog.openWithBoard(board);
      } else {
        this._createDialog.open("board");
      }
    } catch {
      // Detection failed or user cancelled — open wizard at board step as fallback
      this._createDialog.open("board");
    }
  }

  private _toggleDrawerForDevice(device: ConfiguredDevice) {
    /* Card / row activation toggles the drawer rather than always
       opening it, so a keyboard user can hit Enter or Space twice on
       the same card to dismiss it without reaching for Escape. Tapping
       a different card while one is open swaps to the new device. */
    if (this._drawerOpen && this._drawerDevice?.configuration === device.configuration) {
      this._drawerOpen = false;
      return;
    }
    this._drawerDevice = device;
    this._drawerOpen = true;
  }

  private _openCommand(device: ConfiguredDevice, type: CommandType, port?: string) {
    this._commandDialog.configuration = device.configuration;
    this._commandDialog.name = device.friendly_name || device.name;
    this._commandDialog.open(type, port ? { port } : undefined);
  }

  private _showJobProgress(device: ConfiguredDevice) {
    const job = this._activeJobs.get(device.configuration);
    if (!job) return;
    /* Defer to the shared display-name helper so RENAME jobs keep
       the "old → new" transition in their title — clicking the
       Renaming badge used to land in a dialog labelled with just
       the device's friendly name, losing the same context the
       initial rename dialog had. */
    this._commandDialog.followJob(
      job,
      firmwareJobDisplayName(job, this._devices, this._localize),
    );
  }

  private _openInstallMethod(device: ConfiguredDevice) {
    this._installMethodDevice = device;
    this._installMethodMode = "install";
    this._installMethodOpen = true;
  }

  private _onInstallMethodSelect(e: CustomEvent<{ method: string; port?: string }>) {
    const device = this._installMethodDevice;
    this._installMethodOpen = false;
    if (!device) return;

    const { method, port } = e.detail;
    if (this._installMethodMode === "logs") {
      this._openLogsWithMethod(device, method, port);
    } else {
      if (method === "ota") {
        this._openCommand(device, "install", "OTA");
      } else if (method === "server-serial") {
        this._openCommand(device, "install", port!);
      } else if (method === "web-serial") {
        this._firmwareDialog.installWebSerial(device);
      }
    }
  }

  private async _openLogsWithMethod(device: ConfiguredDevice, method: string, port?: string) {
    if (method === "ota") {
      // Network logs
      this._logsDialog.configuration = device.configuration;
      this._logsDialog.name = device.friendly_name || device.name;
      this._logsDialog.open();
    } else if (method === "server-serial") {
      // Server serial logs — pass the selected port
      this._logsDialog.configuration = device.configuration;
      this._logsDialog.name = device.friendly_name || device.name;
      this._logsDialog.open(port);
    } else if (method === "web-serial") {
      // Web Serial logs — prompt port first, then open dialog without auto-streaming
      if (!("serial" in navigator)) {
        toast.error(this._localize("dashboard.logs_web_serial_unsupported"), { richColors: true });
        return;
      }
      try {
        const serialPort = await (navigator as any).serial.requestPort();
        await serialPort.open({ baudRate: 115200 });
        this._logsDialog.configuration = device.configuration;
        this._logsDialog.name = device.friendly_name || device.name;
        this._logsDialog.openPassive();
        const cancelSerial = streamSerialToDialog(serialPort, this._logsDialog);
        this._logsDialog.setSerialCancel(cancelSerial);
      } catch { /* User cancelled */ }
    }
  }

  private _openLogs(device: ConfiguredDevice) {
    if (device.state === DeviceState.ONLINE) {
      this._logsDialog.configuration = device.configuration;
      this._logsDialog.name = device.friendly_name || device.name;
      this._logsDialog.open();
    } else {
      // Device offline — show method picker (reuse install method dialog)
      this._installMethodDevice = device;
      this._installMethodMode = "logs";
      this._installMethodOpen = true;
    }
  }

  private _toggleDevice(configuration: string) {
    const next = new Set(this._selectedDevices);
    if (next.has(configuration)) next.delete(configuration);
    else next.add(configuration);
    this._selectedDevices = next;
  }

  private async _updateSelected() {
    const selected = [...this._selectedDevices];
    this._selectMode = false;
    this._selectedDevices = new Set();
    if (selected.length === 0) {
      toast.info(this._localize("layout.update_all_none"), { richColors: true });
      return;
    }
    toast.info(this._localize("layout.update_all_started", { count: selected.length }), { richColors: true });
    try {
      await this._api.firmwareInstallBulk(selected);
    } catch {
      toast.error(this._localize("layout.update_all_error"), { richColors: true });
    }
  }

  private _deleteSelected() {
    if (this._selectedDevices.size === 0) {
      toast.info(this._localize("dashboard.delete_all_none"), { richColors: true });
      return;
    }
    /* Bulk-delete path — ``_pendingDelete`` stays null so the
       confirm dialog shows the bulk copy ("Delete N device(s)"). */
    this._pendingDelete = null;
    this._confirmDialog.open();
  }

  private _confirmDeleteSingle(device: ConfiguredDevice) {
    /* Per-device kebab Delete — set ``_pendingDelete`` so the
       confirm dialog shows the single-device copy and routes to the
       single-device path. Earlier this skipped the dialog entirely
       and went straight to ``deleteDevice`` — there's no undo, so a
       missed click on the kebab silently nuked the YAML. */
    this._pendingDelete = device;
    this._confirmDialog.open();
  }

  private _executeDelete() {
    if (this._pendingDelete) {
      const target = this._pendingDelete;
      this._pendingDelete = null;
      deleteDevice(target, this._api, this._devices, this._localize);
      return;
    }
    const selected = [...this._selectedDevices];
    this._selectMode = false;
    this._selectedDevices = new Set();
    deleteBulkDevices(selected, this._devices, this._api, this._localize);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-page-dashboard": ESPHomePageDashboard;
  }
}
