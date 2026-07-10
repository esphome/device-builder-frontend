import { consume } from "@lit/context";
import {
  mdiArrowLeft,
  mdiCheckboxMultipleMarkedOutline,
  mdiClipboardTextSearchOutline,
  mdiCloseCircle,
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
import memoizeOne from "memoize-one";
import type { ESPHomeAPI } from "../api/index.js";
import type { AdoptableDevice, ConfiguredDevice, Label } from "../api/types/devices.js";
import type { FirmwareJob } from "../api/types/firmware-jobs.js";
import type { PairingSummary } from "../api/types/remote-build.js";
import type { ArchivedDevice } from "../api/types/system.js";
import { DashboardView } from "../api/types/system.js";
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
  fetchApiKey,
  unarchiveDevice,
} from "../components/dashboard/actions.js";
import { deviceGridStyles } from "../components/dashboard/device-grid-styles.js";
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
  refocusSearchInput,
  setSearchMode,
  syncYamlSearch,
} from "../components/dashboard/search.js";
import { skeletonStyles } from "../components/dashboard/skeleton-styles.js";
import {
  cardSkeletonTemplate,
  tableSkeletonTemplate,
} from "../components/dashboard/skeletons.js";
import { dashboardStyles } from "../components/dashboard/styles.js";
import { yamlModeStyles } from "../components/dashboard/yaml-mode-styles.js";
import { YamlSearchController } from "../components/yaml-search-controller.js";
import {
  activeJobsContext,
  apiContext,
  buildOffloadPairingsContext,
  devicesContext,
  devicesLoadedContext,
  expertModeContext,
  importableDevicesContext,
  labelsContext,
  localizeContext,
  prefsLoadedContext,
  recentJobsContext,
  remoteComputeOnlyContext,
  versionContext,
} from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { runBulkUpdate } from "../util/bulk-update.js";
import {
  loadDashboardFilters,
  saveDashboardFilters,
} from "../util/dashboard-filters-session.js";
import { readDashboardUrl, writeDashboardUrl } from "../util/dashboard-url.js";
import {
  activeFacetCount,
  applyFacetFilters,
  hasActiveFilters,
  matchesDeviceSearch,
  type FacetSelection,
} from "../util/device-filter.js";
import { matchesDeviceName } from "../util/device-search.js";
import { sortDevices } from "../util/device-sort.js";
import { normalizeUpdateBuckets } from "../util/facets.js";
import { computeLabelUsage } from "../util/label-usage.js";
import { navigate } from "../util/navigation.js";
import { notifyInfo } from "../util/notify.js";
import { consumePendingHighlight } from "../util/pending-highlight.js";
import { consumePendingSerialSetup } from "../util/pending-serial-setup.js";
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
import "../components/labels/bulk-labels-dialog.js";
import type { ESPHomeBulkLabelsDialog } from "../components/labels/bulk-labels-dialog.js";
import "../components/labels/label-dialog.js";
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
  "close-circle": mdiCloseCircle,
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

  // When true this install is a remote build node: every device-creation
  // affordance (New device card, FAB, table Create, Adopt, serial wizard)
  // is hidden. See _hideDeviceCreation for the actual gate.
  @consume({ context: remoteComputeOnlyContext, subscribe: true })
  @state()
  _remoteComputeOnly = false;

  // False until preferences load once. Creation fails closed while it's
  // false so a remote-compute install can't flash creation UI when the
  // initial prefs fetch fails (remote_compute_only would still be default).
  @consume({ context: prefsLoadedContext, subscribe: true })
  @state()
  _prefsLoaded = false;

  /** Whether every device-creation affordance should be hidden. */
  get _hideDeviceCreation(): boolean {
    return this._remoteComputeOnly || !this._prefsLoaded;
  }

  // Passed to runBulkUpdate for the NO_COMPATIBLE_PEER toast
  // classifier. Same context the settings dialog reads; null until
  // the subscribe_events seed lands.
  @consume({ context: buildOffloadPairingsContext, subscribe: true })
  @state()
  _pairings: Map<string, PairingSummary> | null = null;

  @consume({ context: versionContext, subscribe: true })
  @state()
  _appVersion = "";

  @consume({ context: expertModeContext, subscribe: true })
  @state()
  _expertMode = false;

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
  /** Update-status buckets (``update_available`` / ``modified``)
   *  selected in the Updates facet. AND semantics — a device must
   *  satisfy every selected bucket — so selecting both narrows to
   *  devices that are both update-available and modified. */
  @state() _selectedUpdateStatus: string[] = [];
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
  @state() _labelDialogOpen = false;
  /** Label being edited in the label dialog; ``null`` = create mode. */
  @state() _labelDialogEditing: Label | null = null;
  @state() _recentlyAdopted: string | null = null;
  @state() _showIgnored = false;
  @state() _view: DashboardView = DashboardView.CARDS;
  @state() _tablePageSize = 25;
  @state() _tableSorting: SortingState | null = null;
  @state() _tableColumnVisibility: VisibilityState | null = null;

  private _adoptHighlightTimer: ReturnType<typeof setTimeout> | null = null;
  _pendingAdoptScroll: string | null = null;
  _actionDevice: ConfiguredDevice | null = null;

  private _sortDevices = memoizeOne((source: ConfiguredDevice[]) => sortDevices(source));
  private _computeLabelUsageMemo = memoizeOne(computeLabelUsage);
  /** id → name map rebuilt once per labels-catalog reference change.
   *  ``_syncUrl`` looks up the names for every selected label id; the
   *  prior shape was a linear search per id, which is O(N×M) over the
   *  full catalog on every search keystroke / facet click. */
  private _labelNamesById = memoizeOne(
    (catalog: Label[]) => new Map(catalog.map((l) => [l.id, l.name]))
  );

  @query("esphome-api-key-dialog") _apiKeyDialog!: ESPHomeApiKeyDialog;
  @query("esphome-archived-devices-dialog")
  _archivedDialog?: ESPHomeArchivedDevicesDialog;
  @query("esphome-confirm-dialog") _confirmDialog!: ESPHomeConfirmDialog;
  @query("esphome-create-config-dialog") _createDialog!: ESPHomeCreateConfigDialog;
  @query("esphome-clone-device-dialog") _cloneDialog!: ESPHomeCloneDeviceDialog;
  @query("esphome-friendly-name-dialog") _friendlyNameDialog!: ESPHomeFriendlyNameDialog;
  @query("esphome-bulk-labels-dialog") _bulkLabelsDialog!: ESPHomeBulkLabelsDialog;
  @query("esphome-rename-device-dialog") _renameDialog!: ESPHomeRenameDeviceDialog;
  @query("esphome-adopt-dialog") _adoptDialog!: ESPHomeAdoptDialog;
  @query("esphome-command-dialog") _commandDialog!: ESPHomeCommandDialog;
  @query("esphome-firmware-install-dialog")
  _firmwareDialog!: ESPHomeFirmwareInstallDialog;
  @query("esphome-logs-dialog") _logsDialog!: ESPHomeLogsDialog;
  @query(".search-input") _searchInputEl?: HTMLElement & { focus: () => void };

  static styles = [
    espHomeStyles,
    inputStyles,
    dashboardStyles,
    deviceGridStyles,
    yamlModeStyles,
    skeletonStyles,
  ];

  private _onSerialSetup = (event: Event) => {
    const port = (event as CustomEvent<{ port: SerialPort | null }>).detail?.port ?? null;
    this._startSerialSetup(port);
  };

  private _startSerialSetup(port: SerialPort | null): void {
    // Remote-compute installs don't create devices; a plugged-in board
    // shouldn't pop the creation wizard.
    if (this._hideDeviceCreation) return;
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
  }
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
    this.toggleAttribute("yaml", this._yamlMode);
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
    // USB "Set it up" actioned from another route stashes the port and
    // navigates here. Defer to first render: _createDialog (@query) and
    // the prefs contexts driving _hideDeviceCreation land during it.
    const pendingSerial = consumePendingSerialSetup();
    if (pendingSerial !== null) {
      void this.updateComplete.then(() => {
        // Bailed back off `/` before first render resolved; don't open the
        // wizard against a torn-down host (the stash is already consumed).
        if (!this.isConnected) return;
        this._startSerialSetup(pendingSerial.port);
      });
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
    // Normalize the user-editable URL to known buckets in canonical order,
    // deduped, so unknown or duplicate ids can't inflate the active-filter
    // count or render duplicate badges.
    if (urlState.updates !== undefined)
      this._selectedUpdateStatus = normalizeUpdateBuckets(urlState.updates);
    if (urlState.view !== undefined) this._view = urlState.view;
    if (urlState.yaml !== undefined) this._yamlMode = urlState.yaml;

    // Seed any facet the URL didn't carry from the session store, so filters
    // survive returning to a bare "/" (command palette, fresh-load back), not
    // just browser-Back. The URL stays authoritative per-field — a deep link or
    // shared URL that sets a facet wins over the session seed. Labels are stored
    // as ids here, so no name resolution is needed (unlike the URL path).
    const saved = loadDashboardFilters();
    if (saved) {
      if (urlState.labels === undefined) this._selectedLabels = saved.labels;
      if (urlState.areas === undefined) this._selectedAreas = saved.areas;
      if (urlState.platforms === undefined) this._selectedPlatforms = saved.platforms;
      if (urlState.states === undefined) this._selectedStates = saved.states;
      if (urlState.updates === undefined)
        this._selectedUpdateStatus = normalizeUpdateBuckets(saved.updates);
    }

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
    "_selectedUpdateStatus",
    "_view",
    "_yamlMode",
  ] as const;

  /** Facet fields persisted to the session store: the URL-synced set minus the
   *  non-facet fields. Derived so adding a facet to ``_urlSyncedFields`` also
   *  makes it session-seeded without touching a second list. */
  private static readonly _sessionSyncedFields =
    ESPHomePageDashboard._urlSyncedFields.filter(
      (f) => f !== "_search" && f !== "_view" && f !== "_yamlMode"
    );

  private _syncUrl(): void {
    // While name resolution is still pending (catalog hasn't loaded
    // yet), round-trip the unresolved names back to the URL so a
    // refresh during that window doesn't drop the param. Once the
    // catalog arrives and we resolve to ids, the catalog → name
    // mapping kicks in below.
    const byId = this._labelNamesById(this._labelsCatalog);
    const labelNames =
      this._pendingLabelNames !== null
        ? this._pendingLabelNames
        : this._selectedLabels.map((id) => byId.get(id)).filter((n): n is string => !!n);
    writeDashboardUrl({
      search: this._search,
      labels: labelNames,
      areas: this._selectedAreas,
      platforms: this._selectedPlatforms,
      states: this._selectedStates,
      updates: this._selectedUpdateStatus,
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
    if (!this._expertMode && this._yamlMode) {
      this._yamlMode = false;
      this._search = "";
      this._yamlSearch.clear();
    }
    if (changed.has("_view")) this.setAttribute("view", this._view);
    if (changed.has("_yamlMode")) this.toggleAttribute("yaml", this._yamlMode);
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
    this._persistFilterState(changed);
  }

  /** Persist filter/search/view state on change. Two layers in one seam: the
   *  URL (authoritative, shareable) and the session store (seeds facets the URL
   *  doesn't carry). On the initial paint this writes the hydrated state back: a
   *  no-op when it came from the URL, but when facets were session-seeded it
   *  promotes them into the address bar via ``replaceState`` so the URL keeps
   *  mirroring the active filters (back stack stays clean). */
  private _persistFilterState(changed: PropertyValues): void {
    if (
      ESPHomePageDashboard._urlSyncedFields.some((f) => changed.has(f)) ||
      // Label ids serialize to the URL by *name* through the catalog, and a
      // catalog push (create / rename) can land after the selection change that
      // referenced it — re-sync so the URL picks up the resolved / renamed names.
      (changed.has("_labelsCatalog") && this._selectedLabels.length > 0)
    ) {
      this._syncUrl();
    }
    // The session store carries only the facets (search / view stay out of
    // scope), so it survives a return to a bare "/" not just browser-Back.
    if (ESPHomePageDashboard._sessionSyncedFields.some((f) => changed.has(f))) {
      // While URL label *names* are still resolving to ids, ``_selectedLabels``
      // is still ``[]`` — keep the previously saved ids rather than clobbering
      // them with the empty placeholder (the resolved ids get saved once the
      // catalog arrives and ``_selectedLabels`` changes).
      const labels =
        this._pendingLabelNames !== null
          ? (loadDashboardFilters()?.labels ?? [])
          : this._selectedLabels;
      saveDashboardFilters({
        labels,
        areas: this._selectedAreas,
        platforms: this._selectedPlatforms,
        states: this._selectedStates,
        updates: this._selectedUpdateStatus,
      });
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
      ${
        this._devices.length > 0 && this._view === DashboardView.CARDS
          ? renderToolbar(this, filtered.length, this._devices.length)
          : ""
      }
      ${showCardEmptyState ? renderEmptySearch(this) : ""}
      ${
        this._view === DashboardView.CARDS
          ? renderCardGrid(this, filtered)
          : renderTable(this)
      }
      ${renderDrawer(this)} ${renderSelectBarOrFab(this)} ${renderDialogs(this)}
    `;
  }

  get _isDeviceSearchActive(): boolean {
    return !this._yamlMode && this._devicesLoaded;
  }

  get _sortedDevices(): ConfiguredDevice[] {
    return this._sortDevices(this._devices);
  }

  /** True when any facet or text search would currently narrow the
   *  device list — used by the empty state to decide whether to
   *  render the "no devices match" pivot, and by the toolbar to
   *  pick the right messaging for the clear button. */
  get _hasActiveFilters(): boolean {
    return hasActiveFilters(this._search, this._facetSelection);
  }

  /** Drives the Filters-button badge — facets only. A lone search isn't
   *  a menu pill, so it clears from the search box's own × instead. */
  get _activeFacetCount(): number {
    return activeFacetCount(this._facetSelection);
  }

  /** The five facet selections bundled for the pure ``device-filter``
   *  helpers. */
  private get _facetSelection(): FacetSelection {
    return {
      selectedLabels: this._selectedLabels,
      selectedAreas: this._selectedAreas,
      selectedPlatforms: this._selectedPlatforms,
      selectedStates: this._selectedStates,
      selectedUpdateStatus: this._selectedUpdateStatus,
    };
  }

  /** Clear just the search box (facets untouched) and refocus it so the
   *  user can retype. Wired to the in-input × control (#1160). */
  _clearSearch = () => {
    this._search = "";
    this._syncYamlSearch();
    refocusSearchInput(this);
  };

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
    this._selectedUpdateStatus = [];
    this._syncYamlSearch();
  };

  /** Apply every active facet filter to the device list. Labels and
   *  update-status use AND semantics (labels: a device must carry
   *  every selected label, the original "drill down by tag stack";
   *  updates: a device must satisfy every selected bucket); area,
   *  platform, and status use OR within the facet and AND across
   *  facets, the conventional faceted-search shape.
   *
   *  Memoised on the six upstream references (``devices`` plus
   *  the five selection arrays) so the two callers inside one
   *  render cycle (``render()`` and ``_currentlyVisibleConfigurations``)
   *  share a single filter pass. Lit's reactive @state pattern
   *  hands out new array references on every selection change,
   *  so the cache invalidates exactly when the user changes a
   *  facet or the upstream device list shifts. */
  private _applyFacetFiltersMemo = memoizeOne(
    (
      devices: ConfiguredDevice[],
      selectedLabels: string[],
      selectedAreas: string[],
      selectedPlatforms: string[],
      selectedStates: string[],
      selectedUpdateStatus: string[]
    ): ConfiguredDevice[] =>
      applyFacetFilters(devices, {
        selectedLabels,
        selectedAreas,
        selectedPlatforms,
        selectedStates,
        selectedUpdateStatus,
      })
  );

  _applyFacetFilters(devices: ConfiguredDevice[]): ConfiguredDevice[] {
    return this._applyFacetFiltersMemo(
      devices,
      this._selectedLabels,
      this._selectedAreas,
      this._selectedPlatforms,
      this._selectedStates,
      this._selectedUpdateStatus
    );
  }

  // Card view: name match. Table view: also matches address/IP/platform/MAC
  // so "Select all" tracks the table's global filter (device-table.ts
  // _globalFilterFn). The MAC predicate is shared so the two can't drift.
  _currentlyVisibleConfigurations(): string[] {
    const q = this._search.trim().toLowerCase();
    const sorted = this._applyFacetFilters(this._sortedDevices);
    if (!q) return sorted.map((d) => d.configuration);
    const isTable = this._view === DashboardView.TABLE;
    return sorted
      .filter((d) => matchesDeviceSearch(d, q, isTable))
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
    return this._computeLabelUsageMemo(this._devices);
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
    this._firmwareDialog.downloadArtifacts(device);

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
    await runBulkUpdate(selected, {
      api: this._api,
      localize: this._localize,
      appVersion: this._appVersion,
      pairings: this._pairings?.values() ?? [],
    });
  };

  _openConfirm(pending: PendingConfirm) {
    this._pendingConfirm = pending;
    this._confirmDialog.open();
  }

  _deleteSelected = () => {
    if (this._selectedDevices.size === 0) {
      notifyInfo(this._localize("dashboard.delete_all_none"));
      return;
    }
    this._openConfirm({ kind: "delete-bulk" });
  };

  _archiveSelected = () => {
    if (this._selectedDevices.size === 0) {
      notifyInfo(this._localize("dashboard.archive_all_none"));
      return;
    }
    this._openConfirm({ kind: "archive-bulk" });
  };

  _labelsSelected = () => {
    if (this._selectedDevices.size === 0) return;
    // Pass configurations (ids) rather than ``Device`` objects; the
    // dialog consumes ``devicesContext`` to resolve them on each
    // render so they stay fresh through any DEVICE_UPDATED events
    // that arrive while the dialog is open.
    this._bulkLabelsDialog.configurations = [...this._selectedDevices];
    this._bulkLabelsDialog.open();
  };

  _confirmDeleteSingle = (device: ConfiguredDevice) =>
    this._openConfirm({ kind: "delete-single", device });
  _confirmDeleteArchived = (device: ArchivedDevice) =>
    this._openConfirm({ kind: "delete-archived", device });
  _confirmArchive = (device: ConfiguredDevice) =>
    this._openConfirm({ kind: "archive-single", device });
  _confirmClearQueuedUpdate = (device: ConfiguredDevice) =>
    this._openConfirm({ kind: "clear-queued-update", device });

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
