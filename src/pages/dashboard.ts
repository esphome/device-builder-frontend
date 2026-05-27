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
import type { SortingState, VisibilityState } from "@tanstack/lit-table";
import { LitElement, html, type PropertyValues } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/index.js";
import type {
  AdoptableDevice,
  ArchivedDevice,
  ConfiguredDevice,
  FirmwareJob,
  Label,
} from "../api/types.js";
import { DashboardView } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  deleteLabel,
  executeClone,
  executeFriendlyName,
  executeRename,
  scheduleScrollIntoView,
  toggleIgnore,
} from "../components/dashboard/actions-ui.js";
import {
  archiveDevice,
  deleteArchivedDevice,
  detectAndOpenWizard,
  downloadFirmware,
  fetchApiKey,
  unarchiveDevice,
} from "../components/dashboard/actions.js";
import {
  onInstallMethodSelect,
  openCommand,
  openInstallMethod,
  openLogs,
  showJobProgress,
} from "../components/dashboard/install.js";
import { loadPreferences, saveTablePreference } from "../components/dashboard/prefs.js";
import {
  renderCardGrid,
  renderDiscoveredSection,
  renderDrawer,
  renderTable,
} from "../components/dashboard/render-content.js";
import {
  renderDialogs,
  executeConfirm as runExecuteConfirm,
  type PendingConfirm,
} from "../components/dashboard/render-dialogs.js";
import {
  renderEmptySearch,
  renderSelectBarOrFab,
  renderToolbar,
  renderYamlToolbar,
} from "../components/dashboard/render-toolbar.js";
import { renderYamlMode } from "../components/dashboard/render-yaml.js";
import {
  maybeFireEmptyStatePreview,
  onSearchKeyDown,
  setSearchMode,
  syncYamlSearch,
} from "../components/dashboard/search.js";
import {
  cardSkeletonTemplate,
  tableSkeletonTemplate,
} from "../components/dashboard/skeletons.js";
import { dashboardStyles } from "../components/dashboard/styles.js";
import { YamlSearchController } from "../components/yaml-search-controller.js";
import {
  activeJobsContext,
  apiContext,
  devicesContext,
  devicesLoadedContext,
  importableDevicesContext,
  labelsContext,
  localizeContext,
  recentJobsContext,
} from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { readDashboardUrl, writeDashboardUrl } from "../util/dashboard-url.js";
import { matchesDeviceName } from "../util/device-search.js";
import { DEVICE_SORT_COLLATOR, deviceSortKey } from "../util/device-sort.js";
import { computeLabelUsage } from "../util/label-usage.js";
import { navigate } from "../util/navigation.js";
import { consumePendingHighlight } from "../util/pending-highlight.js";
import { postInstallShowLogsHandler } from "../util/post-install-logs.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../components/adopt-dialog.js";
import type { ESPHomeAdoptDialog } from "../components/adopt-dialog.js";
import "../components/api-key-dialog.js";
import type { ESPHomeApiKeyDialog } from "../components/api-key-dialog.js";
import "../components/archived-devices-dialog.js";
import type { ESPHomeArchivedDevicesDialog } from "../components/archived-devices-dialog.js";
import "../components/clone-device-dialog.js";
import type { ESPHomeCloneDeviceDialog } from "../components/clone-device-dialog.js";
import "../components/command-dialog.js";
import type { CommandType, ESPHomeCommandDialog } from "../components/command-dialog.js";
import "../components/confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "../components/confirm-dialog.js";
import "../components/dashboard/device-drawer.js";
import "../components/dashboard/device-table.js";
import "../components/dashboard/table-row-menu.js";
import "../components/device-card.js";
import "../components/discovered-device-card.js";
import "../components/firmware-install-dialog.js";
import type { ESPHomeFirmwareInstallDialog } from "../components/firmware-install-dialog.js";
import "../components/friendly-name-dialog.js";
import type { ESPHomeFriendlyNameDialog } from "../components/friendly-name-dialog.js";
import "../components/install-method-dialog.js";
import "../components/labels/labels-filter.js";
import "../components/logs-dialog.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import "../components/rename-device-dialog.js";
import type { ESPHomeRenameDeviceDialog } from "../components/rename-device-dialog.js";
import "../components/select-bar.js";
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
  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;
  @consume({ context: devicesContext, subscribe: true })
  @state()
  _devices: ConfiguredDevice[] = [];
  @consume({ context: importableDevicesContext, subscribe: true })
  @state()
  _importableDevices: AdoptableDevice[] = [];
  @consume({ context: devicesLoadedContext, subscribe: true }) @state() _devicesLoaded =
    false;
  @consume({ context: activeJobsContext, subscribe: true }) @state() _activeJobs: Map<
    string,
    FirmwareJob
  > = new Map();
  @consume({ context: recentJobsContext, subscribe: true }) @state() _recentJobs: Map<
    string,
    FirmwareJob
  > = new Map();
  /** Labels catalog from the WS push. Consumed here so the
   *  dashboard can translate the URL's label *names* (what shared
   *  links carry) into the *ids* the filter pipeline expects, and
   *  back on write. */
  @consume({ context: labelsContext, subscribe: true }) @state() _labelsCatalog: Label[] =
    [];
  @consume({ context: apiContext }) _api!: ESPHomeAPI;

  @state() _showDiscovered = false;
  @state() _search = "";
  @state() _selectedLabels: string[] = [];
  /** Label *names* read from the URL on first paint, waiting to be
   *  resolved to ids once ``_labelsCatalog`` arrives. ``null``
   *  means "no resolution pending" — either the URL had no labels
   *  param or we've already converted them. URL sync prefers this
   *  list while it's set so we round-trip the names verbatim
   *  without dropping the param mid-load. */
  @state() private _pendingLabelNames: string[] | null = null;
  /** Free-text ``esphome.area`` values currently selected in the
   *  Area facet. OR semantics — devices match if their area is in
   *  the set. Combined with other facets via AND at the row level. */
  @state() _selectedAreas: string[] = [];
  /** ``target_platform`` stems selected in the Platform facet. */
  @state() _selectedPlatforms: string[] = [];
  /** ``DeviceState`` values selected in the Status facet. */
  @state() _selectedStates: string[] = [];
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

  private _sortedDevicesCache: {
    source: ConfiguredDevice[];
    sorted: ConfiguredDevice[];
  } | null = null;
  private _labelUsageCache: {
    source: ConfiguredDevice[];
    map: Record<string, number>;
  } | null = null;

  @query("esphome-api-key-dialog") _apiKeyDialog!: ESPHomeApiKeyDialog;
  @query("esphome-archived-devices-dialog")
  _archivedDialog?: ESPHomeArchivedDevicesDialog;
  @query("esphome-confirm-dialog") _confirmDialog!: ESPHomeConfirmDialog;
  @query("esphome-create-config-dialog") _createDialog!: ESPHomeCreateConfigDialog;
  @query("esphome-clone-device-dialog") _cloneDialog!: ESPHomeCloneDeviceDialog;
  @query("esphome-friendly-name-dialog") _friendlyNameDialog!: ESPHomeFriendlyNameDialog;
  @query("esphome-rename-device-dialog") _renameDialog!: ESPHomeRenameDeviceDialog;
  @query("esphome-adopt-dialog") _adoptDialog!: ESPHomeAdoptDialog;
  @query("esphome-command-dialog") _commandDialog!: ESPHomeCommandDialog;
  @query("esphome-firmware-install-dialog")
  _firmwareDialog!: ESPHomeFirmwareInstallDialog;
  @query("esphome-logs-dialog") _logsDialog!: ESPHomeLogsDialog;
  @query(".search-input") _searchInputEl?: HTMLElement & { focus: () => void };

  static styles = [espHomeStyles, inputStyles, dashboardStyles];

  private _onSerialSetup = (event: Event) => {
    const port = (event as CustomEvent<{ port: SerialPort | null }>).detail?.port ?? null;
    void detectAndOpenWizard(this._api, this._createDialog, {
      port,
      devices: this._devices,
      onRecognized: (device) => {
        // Always open (don't toggle) — re-plugging a device that
        // happens to already be selected in the drawer shouldn't
        // close it.
        this._drawerDevice = device;
        this._drawerOpen = true;
      },
      localize: this._localize,
    });
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
      })
    );
  };
  // Kebab path: the banner is hidden when every importable is
  // ignored, so users seeking those cards reach the toggle here.
  // Pop the section open on the way in so they don't land on a
  // collapsed banner and have to click "Show" a second time.
  private _onShowIgnoredFromMenu = () => {
    if (!this._showIgnored) this._showDiscovered = true;
    this._toggleShowIgnored();
  };
  private _onShowArchivedDialog = () => this._archivedDialog?.open();

  _onEnterSelectMode = (configuration?: string) => {
    this._selectMode = true;
    this._selectedDevices = configuration ? new Set([configuration]) : new Set();
  };

  connectedCallback() {
    super.connectedCallback();
    // Hydrate filter / search state from the URL before anything
    // else mounts — a refresh, deep link, or browser-back must land
    // the user on the same view they left, not the default-empty
    // state that would otherwise flash through on first paint.
    this._hydrateFromUrl();
    this.setAttribute("view", this._view);
    this._showIgnored = localStorage.getItem("esphome-show-ignored") === "true";
    window.addEventListener("esphome-serial-setup", this._onSerialSetup);
    window.addEventListener("esphome-show-ignored-changed", this._onShowIgnoredChanged);
    window.addEventListener(
      "esphome-show-ignored-from-menu",
      this._onShowIgnoredFromMenu
    );
    window.addEventListener("esphome-show-archived-dialog", this._onShowArchivedDialog);
    const pending = consumePendingHighlight();
    if (pending !== null) {
      this._highlightFreshDevice(pending);
      this._tryConsumePendingScroll();
    }
  }

  private _hydrateFromUrl(): void {
    const urlState = readDashboardUrl();
    if (urlState.search !== undefined) this._search = urlState.search;
    if (urlState.labels !== undefined) {
      // URL carries label *names* (human-readable, share-friendly).
      // Stash them in ``_pendingLabelNames`` and resolve to ids in
      // ``willUpdate`` once ``_labelsCatalog`` arrives over WS —
      // catalog isn't guaranteed to be loaded yet at this point in
      // ``connectedCallback``.
      this._pendingLabelNames = urlState.labels;
      this._resolvePendingLabelNames();
    }
    if (urlState.areas !== undefined) this._selectedAreas = urlState.areas;
    if (urlState.platforms !== undefined) this._selectedPlatforms = urlState.platforms;
    if (urlState.states !== undefined) this._selectedStates = urlState.states;
    if (urlState.view !== undefined) this._view = urlState.view;
    if (urlState.yaml !== undefined) this._yamlMode = urlState.yaml;

    this._syncYamlSearch();
  }

  /** Convert pending URL-sourced label names to ids using the
   *  current catalog. Case-insensitive match — a shared URL typed
   *  in mixed case shouldn't fail to match a catalog entry that
   *  was created lowercase, or vice versa. Names that don't
   *  resolve are dropped silently; the user sees an empty
   *  selection where the unknown label would have been, which is
   *  the best we can do for a deleted / renamed label. */
  private _resolvePendingLabelNames(): void {
    if (!this._pendingLabelNames) return;
    if (this._labelsCatalog.length === 0) return;
    const byNameLower = new Map<string, string>(
      this._labelsCatalog.map((l) => [l.name.toLowerCase(), l.id])
    );
    const ids = this._pendingLabelNames
      .map((name) => byNameLower.get(name.toLowerCase()))
      .filter((id): id is string => id !== undefined);
    this._selectedLabels = ids;
    this._pendingLabelNames = null;
  }

  /** Set of state fields whose changes need to round-trip to the
   *  URL. Keyed off the Lit ``changed`` map in ``updated``. */
  private static readonly _urlSyncedFields = [
    "_search",
    "_selectedLabels",
    "_selectedAreas",
    "_selectedPlatforms",
    "_selectedStates",
    "_view",
    "_yamlMode",
  ] as const;

  private _syncUrl(): void {
    // While name resolution is still pending (catalog hasn't loaded
    // yet), round-trip the unresolved names back to the URL so a
    // refresh during that window doesn't drop the param. Once the
    // catalog arrives and we resolve to ids, the catalog → name
    // mapping kicks in below.
    const labelNames =
      this._pendingLabelNames !== null
        ? this._pendingLabelNames
        : this._selectedLabels
            .map((id) => this._labelsCatalog.find((l) => l.id === id)?.name)
            .filter((n): n is string => !!n);
    writeDashboardUrl({
      search: this._search,
      labels: labelNames,
      areas: this._selectedAreas,
      platforms: this._selectedPlatforms,
      states: this._selectedStates,
      view: this._view,
      yaml: this._yamlMode,
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("esphome-serial-setup", this._onSerialSetup);
    window.removeEventListener(
      "esphome-show-ignored-changed",
      this._onShowIgnoredChanged
    );
    window.removeEventListener(
      "esphome-show-ignored-from-menu",
      this._onShowIgnoredFromMenu
    );
    window.removeEventListener(
      "esphome-show-archived-dialog",
      this._onShowArchivedDialog
    );
    if (this._adoptHighlightTimer !== null) {
      clearTimeout(this._adoptHighlightTimer);
      this._adoptHighlightTimer = null;
    }
  }

  protected willUpdate(changed: PropertyValues) {
    if (changed.has("_view")) this.setAttribute("view", this._view);
    // ``has-discovered`` is the hook that adds top padding for the
    // discovery banner. Track the same condition the banner renders
    // under so an all-ignored / hide-ignored state doesn't leave
    // empty space at the top of the view.
    if (changed.has("_importableDevices") || changed.has("_showIgnored")) {
      this.toggleAttribute("has-discovered", this._visibleImportableDevices.length > 0);
    }
    if (changed.has("_devicesLoaded") && this._devicesLoaded) void loadPreferences(this);
    // The catalog arrives over WS after ``connectedCallback`` runs.
    // Resolve any URL-sourced pending label names the moment it does.
    if (changed.has("_labelsCatalog")) this._resolvePendingLabelNames();
    // Re-bind drawer to live device so renames / state flaps / DHCP renews
    // don't leave the drawer showing stale fields.
    if (changed.has("_devices") && this._drawerDevice) {
      const live = this._devices.find(
        (d) => d.configuration === this._drawerDevice!.configuration
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
    // Mirror filter / search / view state to the URL on every
    // change, but skip the first paint cycle (where every prop is
    // "changed" because Lit treats initial assignment as a change) —
    // the initial state already came from the URL via
    // ``_hydrateFromUrl``, so writing it back is a no-op.
    if (ESPHomePageDashboard._urlSyncedFields.some((f) => changed.has(f))) {
      this._syncUrl();
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
        ${renderDiscoveredSection(this)} ${renderYamlToolbar(this)}
        ${renderYamlMode(this)} ${renderDrawer(this)} ${renderSelectBarOrFab(this)}
        ${renderDialogs(this)}
      `;
    }

    const q = this._search.trim().toLowerCase();
    const facetFiltered = this._applyFacetFilters(this._sortedDevices);
    const filtered = q
      ? facetFiltered.filter((d) => matchesDeviceName(d, q))
      : facetFiltered;
    // Show the no-results pivot whenever facets and/or search hide
    // every device that actually exists — facet-only filtering used
    // to silently leave the card grid empty with no escape hatch.
    const showCardEmptyState =
      this._view === DashboardView.CARDS &&
      this._devices.length > 0 &&
      filtered.length === 0 &&
      this._hasActiveFilters;

    return html`
      ${renderDiscoveredSection(this)}
      ${this._devices.length > 0 && this._view === DashboardView.CARDS
        ? renderToolbar(this, filtered.length, this._devices.length)
        : ""}
      ${showCardEmptyState ? renderEmptySearch(this) : ""}
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
    if (this._sortedDevicesCache?.source === source)
      return this._sortedDevicesCache.sorted;
    const sorted = [...source].sort((a, b) =>
      DEVICE_SORT_COLLATOR.compare(deviceSortKey(a), deviceSortKey(b))
    );
    this._sortedDevicesCache = { source, sorted };
    return sorted;
  }

  /** True when any facet or text search would currently narrow the
   *  device list — used by the empty state to decide whether to
   *  render the "no devices match" pivot, and by the toolbar to
   *  pick the right messaging for the clear button. */
  get _hasActiveFilters(): boolean {
    return (
      this._search.trim().length > 0 ||
      this._selectedLabels.length > 0 ||
      this._selectedAreas.length > 0 ||
      this._selectedPlatforms.length > 0 ||
      this._selectedStates.length > 0
    );
  }

  /** Wipe search + every facet selection in one shot. Wired to the
   *  empty-state's "Clear filters" button, which only renders when
   *  ``_hasActiveFilters`` — so this is always doing something
   *  visible from the user's perspective. */
  _clearAllFilters = () => {
    this._search = "";
    this._selectedLabels = [];
    this._selectedAreas = [];
    this._selectedPlatforms = [];
    this._selectedStates = [];
    this._syncYamlSearch();
  };

  /** Apply every active facet filter to the device list. Labels
   *  use AND semantics (a device must carry every selected label
   *  — the original "drill down by tag stack" behaviour we shipped
   *  with the labels filter); area, platform, and status use OR
   *  within the facet and AND across facets, the conventional
   *  faceted-search shape. */
  _applyFacetFilters(devices: ConfiguredDevice[]): ConfiguredDevice[] {
    let out = devices;
    if (this._selectedLabels.length > 0) {
      const required = this._selectedLabels;
      out = out.filter((d) => {
        const ids = d.labels;
        if (!ids || ids.length === 0) return false;
        const set = new Set(ids);
        return required.every((id) => set.has(id));
      });
    }
    if (this._selectedAreas.length > 0) {
      const set = new Set(this._selectedAreas);
      out = out.filter((d) => !!d.area && set.has(d.area));
    }
    if (this._selectedPlatforms.length > 0) {
      const set = new Set(this._selectedPlatforms);
      out = out.filter((d) => set.has(d.target_platform));
    }
    if (this._selectedStates.length > 0) {
      const set = new Set(this._selectedStates);
      out = out.filter((d) => set.has(d.state));
    }
    return out;
  }

  // Card view: name match. Table view: also matches address/IP/platform so
  // "Select all" tracks the table's global filter.
  _currentlyVisibleConfigurations(): string[] {
    const q = this._search.trim().toLowerCase();
    const sorted = this._applyFacetFilters(this._sortedDevices);
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
  _setSearchMode = (yamlMode: boolean, search?: string) =>
    setSearchMode(this, yamlMode, search);
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
    e: CustomEvent<{ newFriendlyName: string; install: boolean }>
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
  _onPostInstallShowLogs = postInstallShowLogsHandler(
    () => this._logsDialog,
    () => this._localize
  );
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
    toast.info(this._localize("layout.update_all_started", { count: selected.length }), {
      richColors: true,
    });
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
