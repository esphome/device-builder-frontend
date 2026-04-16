import { consume } from "@lit/context";
import {
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
import type { AdoptableDevice, ConfiguredDevice } from "../api/types.js";
import type { SortingState, VisibilityState } from "@tanstack/lit-table";
import type { LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  devicesContext,
  devicesLoadedContext,
  importableDevicesContext,
  localizeContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";
import {
  deleteBulkDevices,
  deleteDevice,
  downloadYaml,
  editDevice,
  extractApiKey,
  streamSerialToDialog,
} from "./dashboard-actions.js";
import { detectChip, disconnect } from "../util/web-serial.js";
import { cardSkeletonTemplate, tableSkeletonTemplate } from "./dashboard-skeletons.js";
import { dashboardStyles } from "./dashboard-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
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
import "../components/logs-method-dialog.js";
import "../components/rename-device-dialog.js";
import type { ESPHomeRenameDeviceDialog } from "../components/rename-device-dialog.js";
import "../components/select-bar.js";
import "../components/command-dialog.js";
import type { ESPHomeCommandDialog } from "../components/command-dialog.js";
import type { CommandType } from "../components/command-dialog.js";
import "../components/wizard/create-config-dialog.js";
import type { ESPHomeCreateConfigDialog } from "../components/wizard/create-config-dialog.js";

registerMdiIcons({
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

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state() private _showDiscovered = false;
  @state() private _search = "";
  @state() private _logsMethodOpen = false;
  @state() private _logsMethodDevice: ConfiguredDevice | null = null;
  @state() private _selectMode = false;
  @state() private _selectedDevices = new Set<string>();
  @state() private _drawerOpen = false;
  @state() private _drawerDevice: ConfiguredDevice | null = null;
  @state() private _cardContextDevice: ConfiguredDevice | null = null;
  @state() private _cardContextPosition: { x: number; y: number } | null = null;

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

  private _onGlobalEnterSelectMode = () => this._onEnterSelectMode();

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

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute("view", this._view);
    window.addEventListener("esphome-enter-select-mode", this._onGlobalEnterSelectMode);
    window.addEventListener("esphome-serial-setup", this._onSerialSetup);
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
    window.removeEventListener("esphome-enter-select-mode", this._onGlobalEnterSelectMode);
    window.removeEventListener("esphome-serial-setup", this._onSerialSetup);
  }

  @query("esphome-api-key-dialog") private _apiKeyDialog!: ESPHomeApiKeyDialog;
  @query("esphome-confirm-dialog") private _confirmDialog!: ESPHomeConfirmDialog;
  @query("esphome-create-config-dialog") private _createDialog!: ESPHomeCreateConfigDialog;
  @query("esphome-rename-device-dialog") private _renameDialog!: ESPHomeRenameDeviceDialog;
  @query("esphome-command-dialog") private _commandDialog!: ESPHomeCommandDialog;
  @query("esphome-logs-dialog") private _logsDialog!: ESPHomeLogsDialog;

  /** Device currently targeted by rename/api-key actions. */
  private _actionDevice: ConfiguredDevice | null = null;

  static styles = [espHomeStyles, dashboardStyles];

  protected render() {
    if (!this._devicesLoaded) {
      return this._view === DashboardView.TABLE ? tableSkeletonTemplate : cardSkeletonTemplate;
    }

    const q = this._search.trim().toLowerCase();
    const filtered = q
      ? this._devices.filter(
          (d) =>
            (d.friendly_name || d.name).toLowerCase().includes(q) ||
            d.configuration.toLowerCase().includes(q),
        )
      : this._devices;

    return html`
      ${this._renderBanner()}
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

  // ─── Render helpers ───

  private _renderBanner() {
    if (this._importableDevices.length === 0) return "";
    return html`
      <div class="discovered-banner-wrap">
        <div class="discovered-banner">
          <div class="discovered-banner-empty"></div>
          <div style="justify-content: center; display: flex; align-items: center">
            <wa-icon library="mdi" name="clipboard-text-search-outline"></wa-icon>
            <span>${this._localize("dashboard.discovered_count", { count: this._importableDevices.length })}</span>
          </div>
          <a @click=${() => { this._showDiscovered = !this._showDiscovered; }}>${this._localize("dashboard.show")}</a>
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

  private _renderToolbar(matchCount: number, total: number) {
    const q = this._search.trim();
    const unit = matchCount === 1 ? this._localize("dashboard.device_singular") : this._localize("dashboard.device_plural");
    const suffix = q ? " " + this._localize("dashboard.search_of", { total }) : "";
    return html`
      <div class="toolbar">
        <div class="toolbar-row">
          <div class="search-wrap">
            <span class="search-icon"><wa-icon library="mdi" name="magnify"></wa-icon></span>
            <input class="search-input" type="search"
              placeholder=${this._localize("dashboard.search_placeholder")}
              .value=${this._search}
              @input=${(e: Event) => { this._search = (e.target as HTMLInputElement).value; }}
            />
          </div>
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
      <div class="devices-grid">
        ${this._devices.length === 0 ? this._renderAddDeviceCard() : ""}
        ${filtered.map((device) => {
          return html`
            <esphome-device-card
              .name=${device.friendly_name || device.name}
              .configuration=${device.configuration}
              .state=${device.state}
              ?has-pending-changes=${device.has_pending_changes === true}
              ?has-update-available=${!!(device.deployed_version && device.current_version && device.deployed_version !== device.current_version)}
              ?select-mode=${this._selectMode}
              ?selected=${this._selectedDevices.has(device.configuration)}
              @edit-device=${() => editDevice(device)}
              @update-device=${() => this._openCommand(device, "install")}
              @card-click=${() => { this._drawerDevice = device; this._drawerOpen = true; }}
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
        .initialPageSize=${this._tablePageSize}
        .initialSorting=${this._tableSorting}
        .initialColumnVisibility=${this._tableColumnVisibility}
        ?select-mode=${this._selectMode}
        .selectedDevices=${this._selectedDevices}
        @table-sort-change=${this._saveTablePreference}
        @table-visibility-change=${this._saveTablePreference}
        @table-page-size-change=${this._saveTablePreference}
        @row-click=${(e: CustomEvent<ConfiguredDevice>) => { this._drawerDevice = e.detail; this._drawerOpen = true; }}
        @toggle-select=${(e: CustomEvent<string>) => this._toggleDevice(e.detail)}
        @select-all=${() => { this._selectedDevices = new Set(this._devices.map((d) => d.configuration)); }}
        @deselect-all=${() => { this._selectedDevices = new Set(); }}
        @edit-device=${(e: CustomEvent<ConfiguredDevice>) => editDevice(e.detail)}
        @update-device=${(e: CustomEvent<ConfiguredDevice>) => this._openCommand(e.detail, "install")}
        @open-logs=${(e: CustomEvent<ConfiguredDevice>) => this._openLogs(e.detail)}
        @validate-device=${(e: CustomEvent<ConfiguredDevice>) => this._openCommand(e.detail, "validate")}
        @install-device=${(e: CustomEvent<ConfiguredDevice>) => this._openCommand(e.detail, "install")}
        @show-api-key=${(e: CustomEvent<ConfiguredDevice>) => this._showApiKey(e.detail)}
        @download-yaml=${(e: CustomEvent<ConfiguredDevice>) => downloadYaml(e.detail, this._api, this._localize)}
        @rename-device=${(e: CustomEvent<ConfiguredDevice>) => this._openRename(e.detail)}
        @clean-build=${(e: CustomEvent<ConfiguredDevice>) => this._openCommand(e.detail, "clean")}
        @download-elf=${(e: CustomEvent<ConfiguredDevice>) => this._downloadFirmware(e.detail)}
        @delete-device=${(e: CustomEvent<ConfiguredDevice>) => deleteDevice(e.detail, this._api, this._devices, this._localize)}
        @enter-select-mode=${(e: CustomEvent<string>) => this._onEnterSelectMode(e.detail)}
      >
        <div slot="toolbar" class="toolbar-row">
          <div class="search-wrap">
            <span class="search-icon"><wa-icon library="mdi" name="magnify"></wa-icon></span>
            <input class="search-input" type="search"
              placeholder=${this._localize("dashboard.search_placeholder")}
              .value=${this._search}
              @input=${(e: Event) => { this._search = (e.target as HTMLInputElement).value; }}
            />
          </div>
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
        @drawer-close=${() => { this._drawerOpen = false; }}
        @edit-device=${(e: CustomEvent) => { this._drawerOpen = false; editDevice(e.detail); }}
        @update-device=${(e: CustomEvent) => { this._drawerOpen = false; this._openCommand(e.detail, "install"); }}
        @open-logs=${(e: CustomEvent) => { this._drawerOpen = false; this._openLogs(e.detail); }}
      ></esphome-device-drawer>
    `;
  }

  private _renderCardContextMenu() {
    return html`
      <esphome-table-row-menu
        .device=${this._cardContextDevice}
        .position=${this._cardContextPosition}
        @menu-close=${() => { this._cardContextDevice = null; this._cardContextPosition = null; }}
        @edit-device=${(e: CustomEvent<ConfiguredDevice>) => editDevice(e.detail)}
        @update-device=${(e: CustomEvent<ConfiguredDevice>) => this._openCommand(e.detail, "install")}
        @open-logs=${(e: CustomEvent<ConfiguredDevice>) => this._openLogs(e.detail)}
        @validate-device=${(e: CustomEvent<ConfiguredDevice>) => this._openCommand(e.detail, "validate")}
        @install-device=${(e: CustomEvent<ConfiguredDevice>) => this._openCommand(e.detail, "install")}
        @show-api-key=${(e: CustomEvent<ConfiguredDevice>) => this._showApiKey(e.detail)}
        @download-yaml=${(e: CustomEvent<ConfiguredDevice>) => downloadYaml(e.detail, this._api, this._localize)}
        @rename-device=${(e: CustomEvent<ConfiguredDevice>) => this._openRename(e.detail)}
        @clean-build=${(e: CustomEvent<ConfiguredDevice>) => this._openCommand(e.detail, "clean")}
        @download-elf=${(e: CustomEvent<ConfiguredDevice>) => this._downloadFirmware(e.detail)}
        @delete-device=${(e: CustomEvent<ConfiguredDevice>) => deleteDevice(e.detail, this._api, this._devices, this._localize)}
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
    return html`
      <esphome-confirm-dialog
        heading=${this._localize("dashboard.delete_selected_title")}
        message=${this._localize("dashboard.delete_selected_desc", { count: this._selectedDevices.size })}
        confirm-label=${this._localize("dashboard.delete_selected_confirm")}
        destructive
        @confirm=${this._executeDeleteSelected}
      ></esphome-confirm-dialog>
      <esphome-rename-device-dialog
        @rename-confirm=${this._executeRename}
      ></esphome-rename-device-dialog>
      <esphome-api-key-dialog></esphome-api-key-dialog>
      <esphome-create-config-dialog></esphome-create-config-dialog>
      <esphome-command-dialog></esphome-command-dialog>
      <esphome-logs-dialog></esphome-logs-dialog>
      <esphome-logs-method-dialog
        ?open=${this._logsMethodOpen}
        @close=${() => { this._logsMethodOpen = false; }}
        @web-serial=${this._openLogsWebSerial}
      ></esphome-logs-method-dialog>
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
    this._renameDialog.open(device.friendly_name || device.name);
  }

  private async _executeRename(e: CustomEvent<string>) {
    const device = this._actionDevice;
    if (!device) return;
    const newName = e.detail;
    try {
      await this._api.updateDevice({
        name: device.name,
        friendly_name: newName,
      });
      toast.success(this._localize("dashboard.action_rename_success", { name: newName }), { richColors: true });
    } catch {
      toast.error(this._localize("dashboard.action_rename_failed", { name: device.friendly_name || device.name }), { richColors: true });
    }
  }

  private async _showApiKey(device: ConfiguredDevice) {
    const key = await extractApiKey(device, this._api);
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

  private _openCommand(device: ConfiguredDevice, type: CommandType) {
    this._commandDialog.configuration = device.configuration;
    this._commandDialog.name = device.friendly_name || device.name;
    this._commandDialog.open(type);
  }


  private _openLogs(device: ConfiguredDevice) {
    if (device.state === DeviceState.ONLINE) {
      this._logsDialog.configuration = device.configuration;
      this._logsDialog.name = device.friendly_name || device.name;
      this._logsDialog.open();
    } else {
      this._logsMethodDevice = device;
      this._logsMethodOpen = true;
    }
  }

  private async _openLogsWebSerial() {
    const device = this._logsMethodDevice;
    if (!device) return;
    if (!("serial" in navigator)) {
      toast.error(this._localize("dashboard.logs_web_serial_unsupported"), { richColors: true });
      return;
    }
    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });
      this._logsMethodOpen = false;
      this._logsDialog.configuration = device.configuration;
      this._logsDialog.name = device.friendly_name || device.name;
      this._logsDialog.open();
      streamSerialToDialog(port, this._logsDialog);
    } catch { /* User cancelled */ }
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
    this._confirmDialog.open();
  }

  private _executeDeleteSelected() {
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
