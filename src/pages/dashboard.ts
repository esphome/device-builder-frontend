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
import type { AdoptableDevice, ConfiguredDevice } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  deviceStatesContext,
  devicesContext,
  devicesLoadedContext,
  importableDevicesContext,
  localizeContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";
import {
  cleanBuild,
  compileAndUpload,
  deleteDevice,
  downloadElf,
  downloadYaml,
  editDevice,
  extractApiKey,
  installDevice,
  streamSerialToDialog,
  validateDevice,
} from "./dashboard-actions.js";
import { cardSkeletonTemplate, tableSkeletonTemplate } from "./dashboard-skeletons.js";
import { dashboardStyles } from "./dashboard-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../components/api-key-dialog.js";
import type { ESPHomeApiKeyDialog } from "../components/api-key-dialog.js";
import "../components/confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "../components/confirm-dialog.js";
import "../components/dashboard/device-drawer.js";
import "../components/dashboard/device-table.js";
import "../components/device-card.js";
import "../components/logs-dialog.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import "../components/logs-method-dialog.js";
import "../components/rename-device-dialog.js";
import type { ESPHomeRenameDeviceDialog } from "../components/rename-device-dialog.js";
import "../components/select-bar.js";
import "../components/update-dialog.js";
import type { ESPHomeUpdateDialog } from "../components/update-dialog.js";
import "../components/wizard/create-config-dialog.js";
import type { ESPHomeCreateConfigDialog } from "../components/wizard/create-config-dialog.js";

type DashboardView = "cards" | "table";

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

  @consume({ context: deviceStatesContext, subscribe: true })
  @state()
  private _deviceStates: Record<string, boolean> = {};

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

  @state()
  private _view: DashboardView =
    (localStorage.getItem("esphome-dashboard-view") as DashboardView) || "cards";

  private _onEnterSelectMode = (configuration?: string) => {
    this._selectMode = true;
    this._selectedDevices = configuration ? new Set([configuration]) : new Set();
  };

  private _onGlobalEnterSelectMode = () => this._onEnterSelectMode();

  protected willUpdate(changed: PropertyValues) {
    if (changed.has("_view")) {
      this.setAttribute("view", this._view);
    }
  }

  connectedCallback() {
    super.connectedCallback();
    this.setAttribute("view", this._view);
    window.addEventListener("esphome-enter-select-mode", this._onGlobalEnterSelectMode);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("esphome-enter-select-mode", this._onGlobalEnterSelectMode);
  }

  @query("esphome-api-key-dialog") private _apiKeyDialog!: ESPHomeApiKeyDialog;
  @query("esphome-confirm-dialog") private _confirmDialog!: ESPHomeConfirmDialog;
  @query("esphome-create-config-dialog") private _createDialog!: ESPHomeCreateConfigDialog;
  @query("esphome-rename-device-dialog") private _renameDialog!: ESPHomeRenameDeviceDialog;
  @query("esphome-update-dialog") private _updateDialog!: ESPHomeUpdateDialog;
  @query("esphome-logs-dialog") private _logsDialog!: ESPHomeLogsDialog;

  /** Device currently targeted by rename/api-key actions. */
  private _actionDevice: ConfiguredDevice | null = null;

  static styles = [espHomeStyles, dashboardStyles];

  protected render() {
    if (!this._devicesLoaded) {
      return this._view === "table" ? tableSkeletonTemplate : cardSkeletonTemplate;
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
      ${this._devices.length > 0 && this._view === "cards"
        ? this._renderToolbar(filtered.length, this._devices.length)
        : ""}
      ${filtered.length === 0 && q && this._view === "cards" ? this._renderEmptySearch() : ""}
      ${this._view === "cards" ? this._renderCardGrid(filtered) : this._renderTable()}
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
        <button class="view-toggle-btn ${view === "cards" ? "active" : ""}" @click=${() => this._setView("cards")}>
          <wa-icon library="mdi" name="view-grid"></wa-icon>
        </button>
        <button class="view-toggle-btn ${view === "table" ? "active" : ""}" @click=${() => this._setView("table")}>
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
          const online = this._deviceStates[device.configuration] ?? false;
          return html`
            <esphome-device-card
              .name=${device.friendly_name || device.name}
              .configuration=${device.configuration}
              ?online=${online}
              ?select-mode=${this._selectMode}
              ?selected=${this._selectedDevices.has(device.configuration)}
              @edit-device=${() => editDevice(device)}
              @update-device=${() => this._openUpdate(device)}
              @open-logs=${() => this._openLogs(device)}
              @validate-device=${() => validateDevice(device, this._localize)}
              @install-device=${() => installDevice(device, this._localize)}
              @show-api-key=${() => this._showApiKey(device)}
              @download-yaml=${() => downloadYaml(device, this._api)}
              @rename-device=${() => this._openRename(device)}
              @clean-build=${() => cleanBuild(device, this._localize)}
              @download-elf=${() => downloadElf(device, this._localize)}
              @delete-device=${() => deleteDevice(device, this._api, this._devices, this._localize)}
              @toggle-select=${() => this._toggleDevice(device.configuration)}
            ></esphome-device-card>
          `;
        })}
      </div>
    `;
  }

  private _renderTable() {
    return html`
      <esphome-device-table
        .devices=${this._devices}
        .deviceStates=${this._deviceStates}
        .search=${this._search}
        ?select-mode=${this._selectMode}
        .selectedDevices=${this._selectedDevices}
        @row-click=${(e: CustomEvent<ConfiguredDevice>) => { this._drawerDevice = e.detail; this._drawerOpen = true; }}
        @toggle-select=${(e: CustomEvent<string>) => this._toggleDevice(e.detail)}
        @select-all=${() => { this._selectedDevices = new Set(this._devices.map((d) => d.configuration)); }}
        @deselect-all=${() => { this._selectedDevices = new Set(); }}
        @edit-device=${(e: CustomEvent<ConfiguredDevice>) => editDevice(e.detail)}
        @update-device=${(e: CustomEvent<ConfiguredDevice>) => this._openUpdate(e.detail)}
        @open-logs=${(e: CustomEvent<ConfiguredDevice>) => this._openLogs(e.detail)}
        @validate-device=${(e: CustomEvent<ConfiguredDevice>) => validateDevice(e.detail, this._localize)}
        @install-device=${(e: CustomEvent<ConfiguredDevice>) => installDevice(e.detail, this._localize)}
        @show-api-key=${(e: CustomEvent<ConfiguredDevice>) => this._showApiKey(e.detail)}
        @download-yaml=${(e: CustomEvent<ConfiguredDevice>) => downloadYaml(e.detail, this._api)}
        @rename-device=${(e: CustomEvent<ConfiguredDevice>) => this._openRename(e.detail)}
        @clean-build=${(e: CustomEvent<ConfiguredDevice>) => cleanBuild(e.detail, this._localize)}
        @download-elf=${(e: CustomEvent<ConfiguredDevice>) => downloadElf(e.detail, this._localize)}
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
        @update-device=${(e: CustomEvent) => { this._drawerOpen = false; this._openUpdate(e.detail); }}
        @open-logs=${(e: CustomEvent) => { this._drawerOpen = false; this._openLogs(e.detail); }}
      ></esphome-device-drawer>
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
    if (this._view === "cards") {
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
      <esphome-update-dialog></esphome-update-dialog>
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
    localStorage.setItem("esphome-dashboard-view", view);
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

  private _openUpdate(device: ConfiguredDevice) {
    this._updateDialog.configuration = device.configuration;
    this._updateDialog.name = device.friendly_name || device.name;
    this._updateDialog.open();
  }

  private _openLogs(device: ConfiguredDevice) {
    const online = this._deviceStates[device.configuration] ?? false;
    if (online) {
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
    for (const configuration of selected) {
      const device = this._devices.find((d) => d.configuration === configuration);
      if (!device) continue;
      await compileAndUpload(configuration, device.friendly_name || device.name, this._api, this._localize);
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
    for (const configuration of selected) {
      const device = this._devices.find((d) => d.configuration === configuration);
      if (!device) continue;
      deleteDevice(device, this._api, this._devices, this._localize);
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-page-dashboard": ESPHomePageDashboard;
  }
}
