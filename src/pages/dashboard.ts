import { consume } from "@lit/context";
import {
  mdiArrowLeft,
  mdiCheckboxMultipleMarkedOutline,
  mdiClipboardTextSearchOutline,
  mdiCodeBraces,
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
import { DashboardView } from "../api/types.js";
import type {
  AdoptableDevice,
  ArchivedDevice,
  ConfiguredDevice,
  FirmwareJob,
  Label,
} from "../api/types.js";
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
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { YamlSearchController } from "../components/yaml-search-controller.js";
import { matchesDeviceName } from "../util/device-search.js";
import { computeLabelUsage } from "../util/label-usage.js";
import { navigate } from "../util/navigation.js";
import { consumePendingHighlight } from "../util/pending-highlight.js";
import { postInstallShowLogsHandler } from "../util/post-install-logs.js";
import { registerMdiIcons } from "../util/register-icons.js";
import {
  archiveDevice,
  deleteArchivedDevice,
  detectAndOpenWizard,
  downloadFirmware,
  fetchApiKey,
  unarchiveDevice,
} from "../components/dashboard/actions.js";
import {
  deleteLabel,
  executeClone,
  executeFriendlyName,
  executeRename,
  scheduleScrollIntoView,
  toggleIgnore,
} from "../components/dashboard/actions-ui.js";
import { cardSkeletonTemplate, tableSkeletonTemplate } from "../components/dashboard/skeletons.js";
import { dashboardStyles } from "../components/dashboard/styles.js";
import { renderYamlMode } from "../components/dashboard/render-yaml.js";
import {
  renderEmptySearch,
  renderSelectBarOrFab,
  renderToolbar,
  renderYamlToolbar,
} from "../components/dashboard/render-toolbar.js";
import {
  renderCardGrid,
  renderDiscoveredSection,
  renderDrawer,
  renderTable,
} from "../components/dashboard/render-content.js";
import {
  executeConfirm as runExecuteConfirm,
  renderDialogs,
  type PendingConfirm,
} from "../components/dashboard/render-dialogs.js";
import {
  maybeFireEmptyStatePreview,
  onSearchKeyDown,
  setSearchMode,
  syncYamlSearch,
} from "../components/dashboard/search.js";
import { loadPreferences, saveTablePreference } from "../components/dashboard/prefs.js";
import {
  onInstallMethodSelect,
  openCommand,
  openInstallMethod,
  openLogs,
  showJobProgress,
} from "../components/dashboard/install.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../components/api-key-dialog.js";
import type { ESPHomeApiKeyDialog } from "../components/api-key-dialog.js";
import "../components/archived-devices-dialog.js";
import type { ESPHomeArchivedDevicesDialog } from "../components/archived-devices-dialog.js";
import "../components/confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "../components/confirm-dialog.js";
import "../components/dashboard/device-drawer.js";
import "../components/dashboard/device-table.js";
import "../components/dashboard/table-row-menu.js";
import "../components/device-card.js";
import "../components/labels/labels-filter.js";
import "../components/logs-dialog.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import "../components/firmware-install-dialog.js";
import type { ESPHomeFirmwareInstallDialog } from "../components/firmware-install-dialog.js";
import "../components/install-method-dialog.js";
import "../components/clone-device-dialog.js";
import type { ESPHomeCloneDeviceDialog } from "../components/clone-device-dialog.js";
import "../components/friendly-name-dialog.js";
import type { ESPHomeFriendlyNameDialog } from "../components/friendly-name-dialog.js";
import "../components/rename-device-dialog.js";
import type { ESPHomeRenameDeviceDialog } from "../components/rename-device-dialog.js";
import "../components/discovered-device-card.js";
import "../components/adopt-dialog.js";
import type { ESPHomeAdoptDialog } from "../components/adopt-dialog.js";
import "../components/select-bar.js";
import "../components/command-dialog.js";
import type { ESPHomeCommandDialog, CommandType } from "../components/command-dialog.js";
import "../components/wizard/create-config-dialog.js";
import type { ESPHomeCreateConfigDialog } from "../components/wizard/create-config-dialog.js";

registerMdiIcons({
  "arrow-left": mdiArrowLeft,
  "checkbox-multiple-marked-outline": mdiCheckboxMultipleMarkedOutline,
  "clipboard-text-search-outline": mdiClipboardTextSearchOutline,
  "code-braces": mdiCodeBraces,
  magnify: mdiMagnify,
  plus: mdiPlus,
  "view-grid": mdiViewGrid,
  table: mdiTable,
  web: mdiWeb,
});

@customElement("esphome-page-dashboard")
export class ESPHomePageDashboard extends LitElement {
  @consume({ context: localizeContext, subscribe: true }) @state() _localize: LocalizeFunc = (key) => key;
  @consume({ context: devicesContext, subscribe: true }) @state() _devices: ConfiguredDevice[] = [];
  @consume({ context: importableDevicesContext, subscribe: true }) @state() _importableDevices: AdoptableDevice[] = [];
  @consume({ context: devicesLoadedContext, subscribe: true }) @state() _devicesLoaded = false;
  @consume({ context: activeJobsContext, subscribe: true }) @state() _activeJobs: Map<string, FirmwareJob> = new Map();
  @consume({ context: recentJobsContext, subscribe: true }) @state() _recentJobs: Map<string, FirmwareJob> = new Map();
  @consume({ context: apiContext }) _api!: ESPHomeAPI;

  @state() _showDiscovered = false;
  @state() _search = "";
  @state() _selectedLabels: string[] = [];
  @state() _yamlMode = false;
  @state() _yamlPreviewCount = 0;
  _yamlSearch = new YamlSearchController(this, () => this._api);

  @state() _installMethodOpen = false;
  @state() _installMethodDevice: ConfiguredDevice | null = null;
  @state() _installMethodMode: "install" | "logs" = "install";
  @state() _selectMode = false;
  @state() _selectedDevices = new Set<string>();
  @state() _drawerOpen = false;
  @state() _drawerDevice: ConfiguredDevice | null = null;
  @state() _cardContextDevice: ConfiguredDevice | null = null;
  @state() _cardContextPosition: { x: number; y: number } | null = null;
  @state() _pendingConfirm: PendingConfirm | null = null;
  @state() _recentlyAdopted: string | null = null;
  @state() _showIgnored = false;
  @state() _view: DashboardView = DashboardView.CARDS;
  @state() _tablePageSize = 25;
  @state() _tableSorting: SortingState | null = null;
  @state() _tableColumnVisibility: VisibilityState | null = null;

  private _adoptHighlightTimer: ReturnType<typeof setTimeout> | null = null;
  _pendingAdoptScroll: string | null = null;
  _actionDevice: ConfiguredDevice | null = null;

  private static readonly _cardCollator = new Intl.Collator(undefined, {
    sensitivity: "base",
    numeric: true,
  });
  private _sortedDevicesCache: { source: ConfiguredDevice[]; sorted: ConfiguredDevice[] } | null = null;
  private _labelUsageCache: { source: ConfiguredDevice[]; map: Record<string, number> } | null = null;

  @query("esphome-api-key-dialog") _apiKeyDialog!: ESPHomeApiKeyDialog;
  @query("esphome-archived-devices-dialog") _archivedDialog?: ESPHomeArchivedDevicesDialog;
  @query("esphome-confirm-dialog") _confirmDialog!: ESPHomeConfirmDialog;
  @query("esphome-create-config-dialog") _createDialog!: ESPHomeCreateConfigDialog;
  @query("esphome-clone-device-dialog") _cloneDialog!: ESPHomeCloneDeviceDialog;
  @query("esphome-friendly-name-dialog") _friendlyNameDialog!: ESPHomeFriendlyNameDialog;
  @query("esphome-rename-device-dialog") _renameDialog!: ESPHomeRenameDeviceDialog;
  @query("esphome-adopt-dialog") _adoptDialog!: ESPHomeAdoptDialog;
  @query("esphome-command-dialog") _commandDialog!: ESPHomeCommandDialog;
  @query("esphome-firmware-install-dialog") _firmwareDialog!: ESPHomeFirmwareInstallDialog;
  @query("esphome-logs-dialog") _logsDialog!: ESPHomeLogsDialog;
  @query(".search-input") _searchInputEl?: HTMLElement & { focus: () => void };

  static styles = [espHomeStyles, inputStyles, dashboardStyles];

  private _onSerialSetup = () => {
    void detectAndOpenWizard(this._api, this._createDialog);
  };
  private _onShowIgnoredChanged = (e: Event) => {
    this._showIgnored = (e as CustomEvent<{ value: boolean }>).detail.value;
  };

  _toggleShowIgnored = () => {
    this._showIgnored = !this._showIgnored;
    localStorage.setItem("esphome-show-ignored", String(this._showIgnored));
    // Other components / future tabs hook in via this window event.
    window.dispatchEvent(
      new CustomEvent("esphome-show-ignored-changed", {
        detail: { value: this._showIgnored },
      }),
    );
  };
  private _onShowArchivedDialog = () => this._archivedDialog?.open();

  _onEnterSelectMode = (configuration?: string) => {
    this._selectMode = true;
    this._selectedDevices = configuration ? new Set([configuration]) : new Set();
  };

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute("view", this._view);
    this._showIgnored = localStorage.getItem("esphome-show-ignored") === "true";
    window.addEventListener("esphome-serial-setup", this._onSerialSetup);
    window.addEventListener("esphome-show-ignored-changed", this._onShowIgnoredChanged);
    window.addEventListener("esphome-show-archived-dialog", this._onShowArchivedDialog);
    const pending = consumePendingHighlight();
    if (pending !== null) {
      this._highlightFreshDevice(pending);
      this._tryConsumePendingScroll();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("esphome-serial-setup", this._onSerialSetup);
    window.removeEventListener("esphome-show-ignored-changed", this._onShowIgnoredChanged);
    window.removeEventListener("esphome-show-archived-dialog", this._onShowArchivedDialog);
    if (this._adoptHighlightTimer !== null) {
      clearTimeout(this._adoptHighlightTimer);
      this._adoptHighlightTimer = null;
    }
  }

  protected willUpdate(changed: PropertyValues) {
    if (changed.has("_view")) this.setAttribute("view", this._view);
    if (changed.has("_devicesLoaded") && this._devicesLoaded) void loadPreferences(this);
    // Re-bind drawer to live device so renames / state flaps / DHCP renews
    // don't leave the drawer showing stale fields.
    if (changed.has("_devices") && this._drawerDevice) {
      const live = this._devices.find(
        (d) => d.configuration === this._drawerDevice!.configuration,
      );
      if (live && live !== this._drawerDevice) {
        this._drawerDevice = live;
      } else if (!live) {
        this._drawerDevice = null;
        this._drawerOpen = false;
      }
    }
  }

  protected updated(changed: PropertyValues): void {
    if (
      this._pendingAdoptScroll !== null &&
      changed.has("_devices") &&
      this._devices.some((d) => d.configuration === this._pendingAdoptScroll)
    ) {
      const target = this._pendingAdoptScroll;
      this._pendingAdoptScroll = null;
      scheduleScrollIntoView(this, target);
    }
    maybeFireEmptyStatePreview(this, changed);
    const hits = this._yamlSearch.hits;
    if (hits !== null) {
      const next = hits.reduce((sum, h) => sum + h.matches.length, 0);
      if (next !== this._yamlPreviewCount) this._yamlPreviewCount = next;
    }
  }

  protected render() {
    if (!this._devicesLoaded) {
      return this._view === DashboardView.TABLE
        ? tableSkeletonTemplate
        : cardSkeletonTemplate;
    }

    // YAML view: a list of device titles. With an empty query it shows
    // every device's name only; once the user types, devices without
    // matches drop out and matching ones expand to show their YAML
    // snippets.
    if (this._yamlMode) {
      return html`
        ${renderDiscoveredSection(this)}
        ${renderYamlToolbar(this)}
        ${renderYamlMode(this)}
        ${renderDrawer(this)} ${renderSelectBarOrFab(this)} ${renderDialogs(this)}
      `;
    }

    const q = this._search.trim().toLowerCase();
    const labelFiltered = this._applyLabelFilter(this._sortedDevices);
    const filtered = q
      ? labelFiltered.filter((d) => matchesDeviceName(d, q))
      : labelFiltered;

    return html`
      ${renderDiscoveredSection(this)}
      ${this._devices.length > 0 && this._view === DashboardView.CARDS
        ? renderToolbar(this, filtered.length, this._devices.length)
        : ""}
      ${filtered.length === 0 && q && this._view === DashboardView.CARDS
        ? renderEmptySearch(this)
        : ""}
      ${this._view === DashboardView.CARDS
        ? renderCardGrid(this, filtered)
        : renderTable(this)}
      ${renderDrawer(this)} ${renderSelectBarOrFab(this)} ${renderDialogs(this)}
    `;
  }

  get _isDeviceSearchActive(): boolean {
    return !this._yamlMode && this._devicesLoaded;
  }

  get _sortedDevices(): ConfiguredDevice[] {
    const source = this._devices;
    if (this._sortedDevicesCache?.source === source) return this._sortedDevicesCache.sorted;
    const collator = ESPHomePageDashboard._cardCollator;
    const sortKey = (d: ConfiguredDevice) =>
      d.friendly_name || d.name || d.configuration;
    const sorted = [...source].sort((a, b) => collator.compare(sortKey(a), sortKey(b)));
    this._sortedDevicesCache = { source, sorted };
    return sorted;
  }

  _applyLabelFilter(devices: ConfiguredDevice[]): ConfiguredDevice[] {
    if (this._selectedLabels.length === 0) return devices;
    const required = this._selectedLabels;
    return devices.filter((d) => {
      const ids = d.labels;
      if (!ids || ids.length === 0) return false;
      const set = new Set(ids);
      return required.every((id) => set.has(id));
    });
  }

  // Card view: name match. Table view: also matches address/IP/platform so
  // "Select all" tracks the table's global filter.
  _currentlyVisibleConfigurations(): string[] {
    const q = this._search.trim().toLowerCase();
    const sorted = this._applyLabelFilter(this._sortedDevices);
    if (!q) return sorted.map((d) => d.configuration);
    const isTable = this._view === DashboardView.TABLE;
    return sorted
      .filter((d) => {
        if (matchesDeviceName(d, q)) return true;
        if (!isTable) return false;
        return (
          d.address.toLowerCase().includes(q) ||
          d.ip_addresses.some((ip) => ip.toLowerCase().includes(q)) ||
          d.target_platform.toLowerCase().includes(q)
        );
      })
      .map((d) => d.configuration);
  }

  get _allVisibleSelected(): boolean {
    const visible = this._currentlyVisibleConfigurations();
    return visible.length > 0 && visible.every((c) => this._selectedDevices.has(c));
  }

  _addToSelection(configurations: string[]) {
    if (configurations.length === 0) return;
    const next = new Set(this._selectedDevices);
    for (const c of configurations) next.add(c);
    this._selectedDevices = next;
  }

  _removeFromSelection(configurations: string[]) {
    if (configurations.length === 0) return;
    const next = new Set(this._selectedDevices);
    for (const c of configurations) next.delete(c);
    this._selectedDevices = next;
  }

  get _visibleImportableDevices(): AdoptableDevice[] {
    return this._showIgnored
      ? this._importableDevices
      : this._importableDevices.filter((d) => !d.ignored);
  }

  _computeLabelUsage(): Record<string, number> {
    const source = this._devices;
    if (this._labelUsageCache?.source === source) return this._labelUsageCache.map;
    const map = computeLabelUsage(source);
    this._labelUsageCache = { source, map };
    return map;
  }

  _enterDeviceView = (view: DashboardView) => {
    // YAML is a third view option: clicking cards or table exits YAML
    // search and returns to the device list.
    if (this._yamlMode) this._setSearchMode(false);
    this._view = view;
    this._api.updatePreferences({ dashboard_view: view }).catch(() => {});
  };

  _toggleSelectMode = () => {
    if (this._selectMode) {
      this._selectMode = false;
      this._selectedDevices = new Set();
    } else {
      this._selectMode = true;
    }
  };

  _onSearchKeyDown = (e: KeyboardEvent) => onSearchKeyDown(this, e);
  _syncYamlSearch = () => syncYamlSearch(this);
  _setSearchMode = (yamlMode: boolean, search?: string) => setSearchMode(this, yamlMode, search);
  _toggleSearchMode = () => setSearchMode(this, !this._yamlMode);

  _highlightFreshDevice(configuration: string): void {
    this._recentlyAdopted = configuration;
    this._pendingAdoptScroll = configuration;
    if (this._adoptHighlightTimer !== null) clearTimeout(this._adoptHighlightTimer);
    this._adoptHighlightTimer = setTimeout(() => {
      this._recentlyAdopted = null;
      this._adoptHighlightTimer = null;
    }, 4000);
  }

  _onAdopted = (e: CustomEvent<{ name: string; friendlyName: string }>) => {
    this._highlightFreshDevice(`${e.detail.name}.yaml`);
  };

  private _tryConsumePendingScroll(): void {
    if (this._pendingAdoptScroll === null) return;
    const target = this._pendingAdoptScroll;
    if (!this._devices.some((d) => d.configuration === target)) return;
    this._pendingAdoptScroll = null;
    scheduleScrollIntoView(this, target);
  }

  _saveTablePreference = (e: CustomEvent) => saveTablePreference(this, e);

  _openRename = (device: ConfiguredDevice) => {
    this._actionDevice = device;
    this._renameDialog.open(device.name);
  };
  _openClone = (device: ConfiguredDevice) => {
    this._actionDevice = device;
    this._cloneDialog.open(device.name);
  };
  _openFriendlyName = (device: ConfiguredDevice) => {
    this._actionDevice = device;
    this._friendlyNameDialog.open(device.name, device.friendly_name || device.name);
  };

  _executeRename = (e: CustomEvent<string>) => void executeRename(this, e);
  _executeClone = (e: CustomEvent<{ newName: string; newFriendlyName: string }>) =>
    void executeClone(this, e);
  _executeFriendlyName = (
    e: CustomEvent<{ newFriendlyName: string; install: boolean }>,
  ) => void executeFriendlyName(this, e);

  _showApiKey = async (device: ConfiguredDevice) => {
    const key = await fetchApiKey(device, this._api);
    this._apiKeyDialog.open(key);
  };
  _downloadFirmware = (device: ConfiguredDevice) =>
    downloadFirmware(device, this._api, this._localize);

  _toggleDrawerForDevice(device: ConfiguredDevice) {
    if (this._drawerOpen && this._drawerDevice?.configuration === device.configuration) {
      this._drawerOpen = false;
      return;
    }
    this._drawerDevice = device;
    this._drawerOpen = true;
  }

  _openCommand = (device: ConfiguredDevice, type: CommandType, port?: string) =>
    openCommand(this, device, type, port);
  _showJobProgress = (device: ConfiguredDevice) => showJobProgress(this, device);
  _openInstallMethod = (device: ConfiguredDevice) => openInstallMethod(this, device);
  _onInstallMethodSelect = (e: CustomEvent<{ method: string; port?: string }>) =>
    onInstallMethodSelect(this, e);
  _openLogs = (device: ConfiguredDevice) => openLogs(this, device);
  _onPostInstallShowLogs = postInstallShowLogsHandler(() => this._logsDialog);
  _onRequestOpenEditor = (e: CustomEvent<{ configuration: string }>) => {
    navigate(`/device/${encodeURIComponent(e.detail.configuration)}`);
  };

  _toggleDevice(configuration: string) {
    const next = new Set(this._selectedDevices);
    if (next.has(configuration)) next.delete(configuration);
    else next.add(configuration);
    this._selectedDevices = next;
  }

  _updateSelected = async () => {
    const selected = [...this._selectedDevices];
    this._selectMode = false;
    this._selectedDevices = new Set();
    if (selected.length === 0) {
      toast.info(this._localize("layout.update_all_none"), { richColors: true });
      return;
    }
    toast.info(
      this._localize("layout.update_all_started", { count: selected.length }),
      { richColors: true },
    );
    try {
      await this._api.firmwareInstallBulk(selected);
    } catch {
      toast.error(this._localize("layout.update_all_error"), { richColors: true });
    }
  };

  _openConfirm(pending: PendingConfirm) {
    this._pendingConfirm = pending;
    this._confirmDialog.open();
  }

  _deleteSelected = () => {
    if (this._selectedDevices.size === 0) {
      toast.info(this._localize("dashboard.delete_all_none"), { richColors: true });
      return;
    }
    this._openConfirm({ kind: "delete-bulk" });
  };

  _archiveSelected = () => {
    if (this._selectedDevices.size === 0) {
      toast.info(this._localize("dashboard.archive_all_none"), { richColors: true });
      return;
    }
    this._openConfirm({ kind: "archive-bulk" });
  };

  _confirmDeleteSingle = (device: ConfiguredDevice) =>
    this._openConfirm({ kind: "delete-single", device });
  _confirmDeleteArchived = (device: ArchivedDevice) =>
    this._openConfirm({ kind: "delete-archived", device });
  _confirmArchive = (device: ConfiguredDevice) =>
    this._openConfirm({ kind: "archive-single", device });

  _executeConfirm = () => {
    const p = this._pendingConfirm;
    this._pendingConfirm = null;
    if (!p) return;
    runExecuteConfirm(this, p);
  };

  _archiveDevice = (device: ConfiguredDevice) =>
    archiveDevice(device, this._api, this._localize);
  _unarchiveDevice = async (device: ArchivedDevice) => {
    if (await unarchiveDevice(device, this._api, this._localize)) {
      await this._archivedDialog?.refresh();
    }
  };
  _deleteArchivedDevice = async (device: ArchivedDevice) => {
    if (await deleteArchivedDevice(device, this._api, this._localize)) {
      await this._archivedDialog?.refresh();
    }
  };
  _deleteLabel = (label: Label) => deleteLabel(this, label);
  _toggleIgnore = (device: AdoptableDevice) => void toggleIgnore(this, device);
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-page-dashboard": ESPHomePageDashboard;
  }
}
