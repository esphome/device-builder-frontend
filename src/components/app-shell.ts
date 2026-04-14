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
import { DeviceEventType } from "../api/types.js";
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
  deviceStatesContext,
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

  @provide({ context: deviceStatesContext })
  @state()
  private _deviceStates: Record<string, boolean> = {};

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

  connectedCallback() {
    super.connectedCallback();
    this._init();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._api.disconnect();
  }

  private _initDarkMode() {
    const saved = localStorage.getItem("esphome-theme") ?? "system";
    this._applyTheme(saved as "light" | "dark" | "system");
  }

  private _applyTheme(theme: "light" | "dark" | "system") {
    localStorage.setItem("esphome-theme", theme);
    const prefersDark =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : theme === "dark";
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
        const { configuration, online } =
          data as DeviceStateChangedEventData;
        this._deviceStates = {
          ...this._deviceStates,
          [configuration]: online,
        };
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
    this._applyTheme(e.detail as "light" | "dark" | "system");
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-app": ESPHomeApp;
  }
}
