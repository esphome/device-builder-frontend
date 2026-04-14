import { consume } from "@lit/context";
import {
  mdiClipboardTextSearchOutline,
  mdiMagnify,
  mdiPlus,
  mdiWeb,
} from "@mdi/js";
import { LitElement, css, html } from "lit";
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

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../components/device-card.js";
import "../components/logs-dialog.js";
import type { ESPHomeLogsDialog } from "../components/logs-dialog.js";
import "../components/logs-method-dialog.js";
import "../components/select-bar.js";
import "../components/update-dialog.js";
import type { ESPHomeUpdateDialog } from "../components/update-dialog.js";
import "../components/wizard/create-config-dialog.js";
import type { ESPHomeCreateConfigDialog } from "../components/wizard/create-config-dialog.js";

registerMdiIcons({
  "clipboard-text-search-outline": mdiClipboardTextSearchOutline,
  magnify: mdiMagnify,
  plus: mdiPlus,
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

  @state()
  private _showDiscovered = false;

  @state()
  private _search = "";

  @state()
  private _logsMethodOpen = false;

  @state()
  private _logsMethodDevice: ConfiguredDevice | null = null;

  @state()
  private _selectMode = false;

  @state()
  private _selectedDevices = new Set<string>();

  private _onEnterSelectMode = () => {
    this._selectMode = true;
    this._selectedDevices = new Set();
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("esphome-enter-select-mode", this._onEnterSelectMode);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("esphome-enter-select-mode", this._onEnterSelectMode);
  }

  @query("esphome-create-config-dialog")
  private _createDialog!: ESPHomeCreateConfigDialog;

  @query("esphome-update-dialog")
  private _updateDialog!: ESPHomeUpdateDialog;

  @query("esphome-logs-dialog")
  private _logsDialog!: ESPHomeLogsDialog;

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
      }

      /* ─── Discovered Banner ─── */

      @keyframes banner-slide-in {
        from { transform: translateY(-100%); }
        to { transform: translateY(0); }
      }

      .discovered-banner-wrap {
        display: flex;
        justify-content: center;
        overflow: hidden;
      }

      .discovered-banner {
        display: inline-flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--wa-space-xs);
        padding: var(--wa-space-xs) var(--wa-space-l) var(--wa-space-s);
        background: var(--esphome-secondary);
        border-radius: 0 0 var(--wa-border-radius-l) var(--wa-border-radius-l);
        font-size: var(--wa-font-size-s);
        color: var(--esphome-on-primary);
        animation: banner-slide-in 1s cubic-bezier(0.4, 0, 0.2, 1) both;
      }

      .discovered-banner wa-icon { font-size: var(--wa-font-size-m); color: var(--esphome-on-primary); margin-right: 10px; }
      .discovered-banner a { color: var(--esphome-primary-light); cursor: pointer; text-decoration: underline; font-weight: var(--wa-font-weight-bold); font-size: var(--wa-font-size-2xs); margin-left: var(--wa-space-4xl); opacity: 0.85; }
      .discovered-banner a:hover { opacity: 1; }
      .discovered-banner span { font-weight: var(--wa-font-weight-bold); font-size: var(--wa-font-size-xs); }
      .discovered-banner-empty { margin-right: var(--wa-space-4xl); }

      /* ─── Card Grid ─── */

      .devices-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, 300px);
        gap: var(--wa-space-l);
        padding: var(--wa-space-l);
      }

      /* ─── Search toolbar ─── */

      .toolbar { display: flex; flex-direction: column; gap: 6px; padding: var(--wa-space-l) var(--wa-space-l) 0; }

      .search-wrap { position: relative; max-width: 380px; }
      .search-icon { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 18px; color: var(--wa-color-text-quiet); pointer-events: none; display: flex; align-items: center; }
      .search-input { width: 100%; box-sizing: border-box; padding: 9px 14px 9px 38px; font-size: var(--wa-font-size-s); font-family: inherit; color: var(--wa-color-text-normal); background: var(--wa-color-surface-raised); border: var(--wa-border-width-s) solid var(--wa-color-surface-border); border-radius: var(--wa-border-radius-l); outline: none; transition: border-color 0.15s, box-shadow 0.15s; }
      .search-input::placeholder { color: var(--wa-color-text-quiet); }
      .search-input:focus { border-color: var(--esphome-primary); box-shadow: 0 0 0 3px color-mix(in srgb, var(--esphome-primary), transparent 80%); }
      .device-count { font-size: var(--wa-font-size-xs); color: var(--wa-color-text-quiet); padding-left: 2px; }
      .device-count strong { color: var(--wa-color-text-normal); font-weight: var(--wa-font-weight-bold); }

      /* ─── Empty search state ─── */

      .empty-search { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--wa-space-s); padding: var(--wa-space-4xl) var(--wa-space-l); text-align: center; }
      .empty-search-icon { font-size: 48px; color: color-mix(in srgb, var(--esphome-primary), transparent 60%); line-height: 1; }
      .empty-search-title { margin: 0; font-size: var(--wa-font-size-m); font-weight: var(--wa-font-weight-bold); color: var(--wa-color-text-normal); }
      .empty-search-desc { margin: 0; font-size: var(--wa-font-size-s); color: var(--wa-color-text-quiet); max-width: 320px; }
      .empty-search-clear { margin-top: var(--wa-space-xs); background: none; border: var(--wa-border-width-s) solid var(--esphome-primary); color: var(--esphome-primary); padding: 6px 16px; border-radius: var(--wa-border-radius-m); font-size: var(--wa-font-size-s); font-family: inherit; font-weight: var(--wa-font-weight-bold); cursor: pointer; transition: background 0.12s; }
      .empty-search-clear:hover { background: color-mix(in srgb, var(--esphome-primary), transparent 90%); }

      /* ─── Skeleton ─── */

      @keyframes skeleton-shimmer { from { background-position: -400px 0; } to { background-position: 400px 0; } }
      .skeleton-card { border-radius: var(--wa-border-radius-l); border: var(--wa-border-width-s) solid var(--wa-color-surface-border); background: var(--wa-color-surface-raised); overflow: hidden; min-height: 130px; display: flex; flex-direction: column; gap: var(--wa-space-s); padding: var(--wa-space-m); }
      .skeleton-line { border-radius: var(--wa-border-radius-m); background: linear-gradient(90deg, var(--wa-color-surface-border) 25%, color-mix(in srgb, var(--wa-color-surface-border), var(--wa-color-surface-raised) 60%) 50%, var(--wa-color-surface-border) 75%); background-size: 800px 100%; animation: skeleton-shimmer 1.4s infinite linear; }
      .skeleton-line--title { height: 18px; width: 55%; }
      .skeleton-line--subtitle { height: 13px; width: 35%; }
      .skeleton-line--actions { height: 30px; width: 100%; margin-top: auto; }

      /* ─── Add New Device Card ─── */

      .add-device-card { border: 2px dashed color-mix(in srgb, var(--esphome-primary), transparent 50%); border-radius: var(--wa-border-radius-l); padding: var(--wa-space-xl) var(--wa-space-l); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--wa-space-m); background: color-mix(in srgb, var(--esphome-primary), transparent 96%); min-height: 200px; cursor: pointer; transition: border-color 0.15s, background 0.15s, transform 0.15s; }
      .add-device-card:hover { border-color: var(--esphome-primary); background: color-mix(in srgb, var(--esphome-primary), transparent 92%); transform: translateY(-2px); }
      .add-device-icon-wrap { width: 52px; height: 52px; border-radius: 50%; background: var(--esphome-primary); display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 14px color-mix(in srgb, var(--esphome-primary), transparent 50%); transition: box-shadow 0.15s, transform 0.15s; }
      .add-device-card:hover .add-device-icon-wrap { box-shadow: 0 6px 20px color-mix(in srgb, var(--esphome-primary), transparent 35%); transform: scale(1.06); }
      .add-device-icon-wrap wa-icon { font-size: 26px; color: var(--esphome-on-primary); }
      .add-device-label { font-size: var(--wa-font-size-m); font-weight: var(--wa-font-weight-bold); color: var(--esphome-primary); }
      .add-device-hint { font-size: var(--wa-font-size-xs); color: var(--wa-color-text-quiet); text-align: center; }
      .esphome-web-link { display: flex; align-items: center; gap: var(--wa-space-2xs); font-size: var(--wa-font-size-xs); color: var(--wa-color-text-quiet); text-decoration: none; margin-top: var(--wa-space-2xs); }
      .esphome-web-link wa-icon { font-size: 14px; }
      .esphome-web-link:hover { color: var(--esphome-primary); }

      /* ─── FAB ─── */

      .fab-container { position: fixed; bottom: var(--wa-space-xl); right: var(--wa-space-xl); z-index: 10; }
      .fab-btn { display: inline-flex; align-items: center; gap: var(--wa-space-xs); padding: 12px 22px; border-radius: 999px; border: none; background: var(--esphome-primary); color: var(--esphome-on-primary); font-size: var(--wa-font-size-s); font-weight: var(--wa-font-weight-bold); font-family: inherit; cursor: pointer; box-shadow: 0 4px 14px color-mix(in srgb, var(--esphome-primary), transparent 40%), 0 2px 4px rgba(0, 0, 0, 0.12); transition: transform 0.15s, box-shadow 0.15s, background 0.15s; letter-spacing: 0.01em; }
      .fab-btn:hover { background: color-mix(in srgb, var(--esphome-primary), black 10%); transform: translateY(-2px); box-shadow: 0 8px 24px color-mix(in srgb, var(--esphome-primary), transparent 30%), 0 4px 8px rgba(0, 0, 0, 0.14); }
      .fab-btn:active { transform: translateY(0); }
      .fab-btn wa-icon { font-size: 18px; }
    `,
  ];

  protected render() {
    const q = this._search.trim().toLowerCase();
    const filtered = q
      ? this._devices.filter(
          (d) =>
            (d.friendly_name || d.name).toLowerCase().includes(q) ||
            d.configuration.toLowerCase().includes(q),
        )
      : this._devices;
    const total = this._devices.length;

    if (!this._devicesLoaded) {
      return html`
        <div class="devices-grid">
          ${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(
            () => html`
              <div class="skeleton-card" aria-hidden="true">
                <div class="skeleton-line skeleton-line--title"></div>
                <div class="skeleton-line skeleton-line--subtitle"></div>
                <div class="skeleton-line skeleton-line--actions"></div>
              </div>
            `,
          )}
        </div>
      `;
    }

    return html`
      ${this._importableDevices.length > 0
        ? html`
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
          `
        : ""}
      ${total > 0 ? this._renderToolbar(filtered.length, total) : ""}
      ${filtered.length === 0 && q
        ? html`
            <div class="empty-search">
              <wa-icon class="empty-search-icon" library="mdi" name="magnify"></wa-icon>
              <h3 class="empty-search-title">${this._localize("dashboard.no_results_title")}</h3>
              <p class="empty-search-desc">${this._localize("dashboard.no_results_desc", { query: this._search.trim() })}</p>
              <button class="empty-search-clear" @click=${() => { this._search = ""; }}>${this._localize("dashboard.no_results_clear")}</button>
            </div>
          `
        : ""}
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
              @edit-device=${() => this._editDevice(device)}
              @update-device=${() => this._openUpdate(device)}
              @open-logs=${() => this._openLogs(device)}
              @delete-device=${() => this._deleteDevice(device)}
              @toggle-select=${() => this._toggleDevice(device.configuration)}
            ></esphome-device-card>
          `;
        })}
      </div>
      ${this._selectMode
        ? html`
            <esphome-select-bar
              selected-count=${this._selectedDevices.size}
              total-count=${this._devices.length}
              @select-all=${() => { this._selectedDevices = new Set(this._devices.map((d) => d.configuration)); }}
              @deselect-all=${() => { this._selectedDevices = new Set(); }}
              @cancel=${() => { this._selectMode = false; this._selectedDevices = new Set(); }}
              @update-selected=${this._updateSelected}
            ></esphome-select-bar>
          `
        : html`
            <div class="fab-container">
              <button class="fab-btn" @click=${() => this._createDialog.open()}>
                <wa-icon library="mdi" name="plus"></wa-icon>
                ${this._localize("dashboard.create_device")}
              </button>
            </div>
          `}
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

  private _renderToolbar(matchCount: number, total: number) {
    const q = this._search.trim();
    const unit = matchCount === 1 ? this._localize("dashboard.device_singular") : this._localize("dashboard.device_plural");
    const suffix = q ? " " + this._localize("dashboard.search_of", { total }) : "";
    return html`
      <div class="toolbar">
        <div class="search-wrap">
          <span class="search-icon"><wa-icon library="mdi" name="magnify"></wa-icon></span>
          <input class="search-input" type="search" placeholder=${this._localize("dashboard.search_placeholder")} .value=${this._search} @input=${(e: Event) => { this._search = (e.target as HTMLInputElement).value; }} />
        </div>
        <span class="device-count"><strong>${matchCount}</strong> ${unit}${suffix}</span>
      </div>
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

  // ─── Device Actions ────────────────────────────────────────

  private _editDevice(device: ConfiguredDevice) {
    window.history.pushState({}, "", `/device/${device.configuration}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  private _deleteDevice(device: ConfiguredDevice) {
    const name = device.friendly_name || device.name;
    toast.success(this._localize("dashboard.deleted", { name }), { richColors: true });
    this._api.deleteDevice(device.configuration).catch(() => {
      if (this._devices.some((d) => d.configuration === device.configuration)) {
        toast.error(this._localize("dashboard.delete_failed", { name }), { richColors: true });
      }
    });
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
    if (!this._logsMethodDevice) return;
    if (!("serial" in navigator)) {
      toast.error(this._localize("dashboard.logs_web_serial_unsupported"), { richColors: true });
      return;
    }
    try {
      const port = await (navigator as any).serial.requestPort();
      await port.open({ baudRate: 115200 });
      this._logsMethodOpen = false;

      const device = this._logsMethodDevice;
      this._logsDialog.configuration = device.configuration;
      this._logsDialog.name = device.friendly_name || device.name;
      this._logsDialog.open();

      const decoder = new TextDecoderStream();
      port.readable.pipeTo(decoder.writable);
      const reader = decoder.readable.getReader();
      let buffer = "";
      const readLoop = async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += value;
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
              (this._logsDialog as any)._lines = [...(this._logsDialog as any)._lines, line];
            }
          }
        } catch {
          // Port closed or disconnected
        }
      };
      readLoop();
    } catch {
      // User cancelled the port picker
    }
  }

  // ─── Select Mode / Update All ──────────────────────────────

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
      const name = device.friendly_name || device.name;
      await this._compileAndUpload(configuration, name);
    }
  }

  private _compileAndUpload(configuration: string, name: string): Promise<void> {
    return new Promise((resolve) => {
      this._api.compile(configuration, {
        onOutput: () => {},
        onResult: (data: { success: boolean; code: number }) => {
          if (data.success) {
            this._api.upload(configuration, "OTA", {
              onOutput: () => {},
              onResult: (d: { success: boolean; code: number }) => {
                toast[d.success ? "success" : "error"](
                  this._localize(d.success ? "dashboard.update_device_success" : "dashboard.update_device_failed", { name }),
                  { richColors: true },
                );
                resolve();
              },
              onError: () => { toast.error(this._localize("dashboard.update_device_failed", { name }), { richColors: true }); resolve(); },
            });
          } else {
            toast.error(this._localize("dashboard.update_device_failed", { name }), { richColors: true });
            resolve();
          }
        },
        onError: () => { toast.error(this._localize("dashboard.update_device_failed", { name }), { richColors: true }); resolve(); },
      });
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-page-dashboard": ESPHomePageDashboard;
  }
}
