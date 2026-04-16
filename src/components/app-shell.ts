/**
 * Main application shell.
 *
 * - Provides Lit context for API, devices, state, and dark mode to all children
 * - Sets up the @lit-labs/router for page navigation
 * - Connects to the /ws WebSocket for all communication
 * - Subscribes to real-time push events via subscribe_events
 * - Auto-detects dark mode from system preference
 */
import { Router } from "@lit-labs/router";
import { provide } from "@lit/context";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import toast from "sonner-js";
import { ESPHomeAPI } from "../api/index.js";
import { DeviceEventType, DeviceState, Theme } from "../api/types.js";
import type {
  AdoptableDevice,
  ConfiguredDevice,
  DeviceEventData,
  DeviceStateChangedEventData,
  ImportableDeviceEventData,
  InitialStateEventData,
  ServerInfoMessage,
} from "../api/types.js";
import { defaultLocalize, loadLocalize, type LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  darkModeContext,
  devicesContext,
  devicesLoadedContext,
  importableDevicesContext,
  localizeContext,
  versionContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";

// Import child components
import "../pages/dashboard.js";
import "./esphome-layout.js";

@customElement("esphome-app")
export class ESPHomeApp extends LitElement {
  // ─── Context Providers ───────────────────────────────────

  @provide({ context: apiContext })
  private _api = new ESPHomeAPI();

  @provide({ context: devicesContext })
  @state()
  private _devices: ConfiguredDevice[] = [];

  @provide({ context: importableDevicesContext })
  @state()
  private _importableDevices: AdoptableDevice[] = [];

  @provide({ context: devicesLoadedContext })
  @state()
  private _devicesLoaded = false;

  @provide({ context: versionContext })
  @state()
  private _version = "";

  @provide({ context: darkModeContext })
  @state()
  private _darkMode = false;

  @provide({ context: localizeContext })
  @state()
  private _localize: LocalizeFunc = defaultLocalize;

  // ─── Router ──────────────────────────────────────────────

  private _router = new Router(this, [
    {
      path: "/",
      render: () => html`<esphome-page-dashboard></esphome-page-dashboard>`,
    },
    {
      path: "/secrets",
      enter: async () => {
        await import("../pages/secrets.js");
        return true;
      },
      render: () => html`<esphome-page-secrets></esphome-page-secrets>`,
    },
    {
      path: "/device/:id",
      enter: async () => {
        await import("../pages/device.js");
        return true;
      },
      render: ({ id }) =>
        html`<esphome-page-device .id=${id ?? ""}></esphome-page-device>`,
    },
  ]);

  // ─── State ───────────────────────────────────────────────

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: block;
        height: 100vh;
        width: 100vw;
        overflow-y: auto;
        background: var(--wa-color-surface-default, #f8f9fa);
      }
    `,
  ];

  // ─── Lifecycle ───────────────────────────────────────────

  private _onSerialConnect = () => {
    toast.info(this._localize("layout.usb_device_connected"), {
      richColors: true,
      duration: 8000,
      action: {
        label: this._localize("layout.usb_device_setup"),
        onClick: () => {
          window.dispatchEvent(new CustomEvent("esphome-serial-setup"));
        },
      },
    });
  };

  connectedCallback() {
    super.connectedCallback();
    this._init();
    if ("serial" in navigator) {
      navigator.serial.addEventListener("connect", this._onSerialConnect);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._api.disconnect();
    if ("serial" in navigator) {
      navigator.serial.removeEventListener("connect", this._onSerialConnect);
    }
  }

  private _initDarkMode() {
    // Use localStorage as fast initial value, then sync from backend
    const saved = (localStorage.getItem("esphome-theme") as Theme) ?? Theme.SYSTEM;
    this._applyTheme(saved);
  }

  private async _loadThemePreference() {
    try {
      const prefs = await this._api.getPreferences();
      this._applyTheme(prefs.theme);
    } catch {
      // Preferences not critical — keep localStorage value
    }
  }

  private _applyTheme(theme: Theme) {
    // Cache in localStorage for fast initial paint and header-actions sync reads
    localStorage.setItem("esphome-theme", theme);
    const prefersDark =
      theme === Theme.SYSTEM
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : theme === Theme.DARK;
    this._darkMode = prefersDark;
    document.documentElement.classList.toggle("wa-dark", prefersDark);
    document.documentElement.classList.toggle("wa-light", !prefersDark);
  }

  private async _init() {
    toast.config({
      toastOptions: { position: "bottom-right", richColors: true, duration: 4000 },
    });
    this._initDarkMode();
    try {
      this._localize = await loadLocalize();
    } catch (err) {
      console.error("Failed to load localization, falling back to default:", err);
      this._localize = ((key: string, ..._args: unknown[]) => key) as LocalizeFunc;
    }

    // Set up connection callbacks
    this._api.onConnected = (info: ServerInfoMessage) => {
      this._version = info.esphome_version;
      this._subscribeToEvents();
    };

    this._api.onDisconnected = () => {
      console.warn("WebSocket disconnected, will auto-reconnect...");
    };

    // Connect to WebSocket
    try {
      const info = await this._api.connect();
      this._version = info.esphome_version;
      // Sync theme from backend once connected
      this._loadThemePreference();
    } catch (err) {
      console.error("Failed to connect to WebSocket:", err);
    }
  }

  // ─── Event Subscription ──────────────────────────────────

  private async _subscribeToEvents() {
    try {
      await this._api.subscribeEvents((event, data) =>
        this._handleEvent(event, data)
      );
    } catch (err) {
      console.error("Failed to subscribe to events:", err);
    }
  }

  private _handleEvent(event: string, data: unknown): void {
    switch (event) {
      case DeviceEventType.INITIAL_STATE: {
        const { devices } = data as InitialStateEventData;
        this._devices = devices;
        this._devicesLoaded = true;
        break;
      }
      case DeviceEventType.DEVICE_ADDED: {
        const { device } = data as DeviceEventData;
        // Add if not already present
        if (!this._devices.some((d) => d.configuration === device.configuration)) {
          this._devices = [...this._devices, device];
        }
        break;
      }
      case DeviceEventType.DEVICE_UPDATED: {
        const { device } = data as DeviceEventData;
        this._devices = this._devices.map((d) =>
          d.configuration === device.configuration ? device : d
        );
        break;
      }
      case DeviceEventType.DEVICE_REMOVED: {
        const { device } = data as DeviceEventData;
        this._devices = this._devices.filter(
          (d) => d.configuration !== device.configuration
        );
        break;
      }
      case DeviceEventType.DEVICE_STATE_CHANGED: {
        const { configuration, state } =
          data as DeviceStateChangedEventData;
        this._devices = this._devices.map((d) =>
          d.configuration === configuration
            ? { ...d, state: state as DeviceState }
            : d
        );
        break;
      }
      case DeviceEventType.IMPORTABLE_DEVICE_ADDED: {
        const { device } = data as ImportableDeviceEventData;
        if (!this._importableDevices.some((d) => d.name === device.name)) {
          this._importableDevices = [...this._importableDevices, device];
        }
        break;
      }
      case DeviceEventType.IMPORTABLE_DEVICE_REMOVED: {
        const { device } = data as ImportableDeviceEventData;
        this._importableDevices = this._importableDevices.filter(
          (d) => d.name !== device.name
        );
        break;
      }
    }
  }

  // ─── Render ──────────────────────────────────────────────

  protected render() {
    return html`
      <esphome-layout @set-theme=${this._onSetTheme}>
        ${this._router.outlet()}
      </esphome-layout>
    `;
  }

  private _onSetTheme(e: CustomEvent<string>) {
    const theme = e.detail as Theme;
    this._applyTheme(theme);
    this._api.updatePreferences({ theme }).catch(() => {});
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-app": ESPHomeApp;
  }
}
