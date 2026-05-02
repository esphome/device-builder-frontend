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
import { customElement, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import { ESPHomeAPI } from "../api/index.js";
import {
  DeviceEventType,
  DeviceState,
  JobStatus,
  JobType,
  Theme,
} from "../api/types.js";
import type {
  AdoptableDevice,
  ConfiguredDevice,
  DeviceEventData,
  DeviceStateChangedEventData,
  FirmwareJob,
  ImportableDeviceAddedEventData,
  ImportableDeviceRemovedEventData,
  InitialStateEventData,
  ServerInfoMessage,
} from "../api/types.js";
import {
  clearStoredLocale,
  defaultLocalize,
  loadLocalize,
  type LocalizeFunc,
  type SupportedLocale,
  writeStoredLocale,
} from "../common/localize.js";
import {
  apiContext,
  darkModeContext,
  devicesContext,
  devicesLoadedContext,
  activeJobsContext,
  recentJobsContext,
  firmwareJobsContext,
  importableDevicesContext,
  integrationDocsContext,
  isHaIngressContext,
  localizeContext,
  versionContext,
  yamlDiffButtonContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";

// Mirrors the backend's `_PRIMARY_JOB_TYPES` retention pool — these
// are the job types deduplicated to one terminal entry per device.
const PRIMARY_JOB_TYPES: ReadonlySet<JobType> = new Set([
  JobType.COMPILE,
  JobType.UPLOAD,
  JobType.INSTALL,
]);

const TERMINAL_STATUSES: ReadonlySet<JobStatus> = new Set([
  JobStatus.COMPLETED,
  JobStatus.FAILED,
  JobStatus.CANCELLED,
]);

/** Extra ``_activeJobs`` keys to mirror this job under, beyond the
 *  primary ``job.configuration`` slot. Today only ``RENAME`` needs
 *  it: the new YAML appears mid-flight so the soon-to-be-named device
 *  card needs to find the live job too. The new YAML's extension is
 *  derived from the *old* YAML's extension (``.yaml`` or ``.yml``)
 *  so devices using ``.yml`` still match. */
function _renameKeys(job: FirmwareJob): string[] {
  if (job.job_type !== JobType.RENAME) return [];
  if (!job.new_name) return [];
  const extMatch = job.configuration.match(/\.ya?ml$/);
  const ext = extMatch ? extMatch[0] : ".yaml";
  const renamed = `${job.new_name}${ext}`;
  return renamed === job.configuration ? [] : [renamed];
}

// How long a terminated job stays in `_recentJobs` so the dashboard
// can flash a status indicator after the spinner clears. Successful
// completions revert quickly so the device's real online/offline
// state isn't masked for a third of a minute (the user complaint
// "Clean build files says completed for too long"); failed /
// cancelled jobs linger longer so the user has time to notice them
// before the indicator times out.
const RECENT_JOB_TTL_MS_COMPLETED = 10_000;
// Used for every non-COMPLETED terminal status (FAILED, CANCELLED).
const RECENT_JOB_TTL_MS_ATTENTION = 30_000;

// Import child components
import "../pages/dashboard.js";
import "./command-palette.js";
import "./esphome-layout.js";
import "./firmware-jobs-dialog.js";
import type { ESPHomeFirmwareJobsDialog } from "./firmware-jobs-dialog.js";
import "./settings-dialog.js";
import type { ESPHomeSettingsDialog } from "./settings-dialog.js";

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

  @provide({ context: isHaIngressContext })
  @state()
  private _isHaIngress = false;

  @provide({ context: activeJobsContext })
  @state()
  private _activeJobs: Map<string, FirmwareJob> = new Map();

  @provide({ context: recentJobsContext })
  @state()
  private _recentJobs: Map<string, FirmwareJob> = new Map();

  /** Per-device timeout handles for `_recentJobs` cleanup. */
  private _recentJobTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  @provide({ context: firmwareJobsContext })
  @state()
  private _firmwareJobs: Map<string, FirmwareJob> = new Map();

  @provide({ context: localizeContext })
  @state()
  private _localize: LocalizeFunc = defaultLocalize;

  @provide({ context: yamlDiffButtonContext })
  @state()
  private _yamlDiffButton = false;

  // Frozen catalog-derived map; refreshed only with a backend release.
  // Cheap to leave at {} until the fetch lands — the device drawer
  // falls back to plain-text tags whenever a name isn't in the map.
  @provide({ context: integrationDocsContext })
  @state()
  private _integrationDocs: Record<string, string> = {};

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
    this._clearRecentJobs();
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
      this._yamlDiffButton = prefs.yaml_diff_button;
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
      this._isHaIngress = info.ha_addon && window.location.pathname.includes("/ingress");
      this._subscribeToEvents();
      this._subscribeToFollowJobs();
      this._loadIntegrationDocs();
    };

    this._api.onDisconnected = () => {
      console.warn("WebSocket disconnected, will auto-reconnect...");
    };

    // Connect to WebSocket
    try {
      const info = await this._api.connect();
      this._version = info.esphome_version;
      this._isHaIngress = info.ha_addon && window.location.pathname.includes("/ingress");
      // Sync theme from backend once connected
      this._loadThemePreference();
    } catch (err) {
      console.error("Failed to connect to WebSocket:", err);
    }
  }

  /**
   * Fetch the integration → docs URL map once per connection and stash
   * it in context. The map is catalog-derived and only changes with a
   * backend release, so no need to re-fetch on event flow. A failure
   * here is non-fatal: we leave ``_integrationDocs`` empty and the
   * drawer falls back to plain-text tags.
   */
  private async _loadIntegrationDocs() {
    try {
      this._integrationDocs = await this._api.getIntegrationDocs();
    } catch (err) {
      console.warn("Failed to load integration docs URLs:", err);
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

  /**
   * Subscribe to `firmware/follow_jobs` for the canonical view of every
   * job. Replaces an earlier flow that combined `firmware/get_jobs` with
   * partial events from `subscribe_events` — that path missed
   * `job_progress` and `job_cancelled`. We reset both job maps on
   * (re)connect so the snapshot is the source of truth.
   */
  private _subscribeToFollowJobs() {
    this._activeJobs = new Map();
    this._firmwareJobs = new Map();
    this._clearRecentJobs();
    try {
      this._api.firmwareFollowJobs((event, data) =>
        this._handleJobEvent(event, data)
      );
    } catch (err) {
      console.error("Failed to follow firmware jobs:", err);
    }
  }

  private _clearRecentJobs() {
    for (const timer of this._recentJobTimers.values()) {
      clearTimeout(timer);
    }
    this._recentJobTimers.clear();
    this._recentJobs = new Map();
  }

  private _handleJobEvent(event: string, data: unknown): void {
    switch (event) {
      case "snapshot":
      case "job_queued":
      case "job_started": {
        this._upsertJob(data as FirmwareJob);
        break;
      }
      case "job_completed":
      case "job_failed":
      case "job_cancelled": {
        this._terminateJob(data as FirmwareJob);
        break;
      }
      case "job_progress": {
        const { job_id, progress } = data as { job_id: string; progress: number };
        const existing = this._firmwareJobs.get(job_id);
        if (!existing) return;
        const updated = { ...existing, progress };
        const next = new Map(this._firmwareJobs);
        next.set(job_id, updated);
        this._firmwareJobs = next;
        if (this._activeJobs.get(updated.configuration)?.job_id === job_id) {
          const active = new Map(this._activeJobs);
          active.set(updated.configuration, updated);
          this._activeJobs = active;
        }
        break;
      }
      // job_output is handled per-job via firmware/follow_job in the
      // command-dialog — no app-level use for the line stream.
    }
  }

  private _upsertJob(job: FirmwareJob): void {
    const next = new Map(this._firmwareJobs);
    next.set(job.job_id, job);
    this._firmwareJobs = next;
    // Snapshots replay terminal jobs too — those belong only in the
    // history map. Treating them as active leaves the spinner stuck on
    // the device after a reconnect.
    if (TERMINAL_STATUSES.has(job.status)) return;
    const active = new Map(this._activeJobs);
    active.set(job.configuration, job);
    /* RENAME writes a *new* YAML during the job — the new device card
       (configured under ``new_name.yaml``) appears mid-flight and
       would otherwise sit at "Unknown" because nothing in
       ``_activeJobs`` is keyed under its filename. Mirror the entry
       under the new key so both the old and new cards show the
       Renaming spinner until the job lands. */
    for (const key of _renameKeys(job)) active.set(key, job);
    this._activeJobs = active;
  }

  /** Job reached a terminal state — keep it in `_firmwareJobs` for
   *  the manage-tasks panel's retained history, drop any older
   *  terminal entry for the same device so a re-compile replaces
   *  rather than stacks, then clear the per-device "active" slot.
   *  Cancellations that already have a live successor for the same
   *  device are treated as a backend supersede and dropped silently
   *  (no "Recent" entry) — the backend fires JOB_QUEUED for the new
   *  job before cancelling the old one specifically so we can spot
   *  this case here. */
  private _terminateJob(job: FirmwareJob): void {
    if (job.status === JobStatus.CANCELLED && job.configuration) {
      const supersededByActive = [...this._firmwareJobs.values()].some(
        (j) =>
          j.job_id !== job.job_id &&
          j.configuration === job.configuration &&
          !TERMINAL_STATUSES.has(j.status),
      );
      if (supersededByActive) {
        const next = new Map(this._firmwareJobs);
        next.delete(job.job_id);
        this._firmwareJobs = next;
        return;
      }
    }
    const next = new Map(this._firmwareJobs);
    next.set(job.job_id, job);
    if (PRIMARY_JOB_TYPES.has(job.job_type) && job.configuration) {
      for (const [id, existing] of next) {
        if (id === job.job_id) continue;
        if (
          PRIMARY_JOB_TYPES.has(existing.job_type) &&
          existing.configuration === job.configuration &&
          TERMINAL_STATUSES.has(existing.status)
        ) {
          next.delete(id);
        }
      }
    }
    this._firmwareJobs = next;
    // Only clear the per-device active slot if it points at *this* job —
    // a freshly-queued follow-up for the same device must stay visible.
    let active: Map<string, FirmwareJob> | null = null;
    if (this._activeJobs.get(job.configuration)?.job_id === job.job_id) {
      active = new Map(this._activeJobs);
      active.delete(job.configuration);
    }
    /* Mirror cleanup for the rename's new-name key — see _upsertJob. */
    for (const key of _renameKeys(job)) {
      if (this._activeJobs.get(key)?.job_id !== job.job_id) continue;
      active = active ?? new Map(this._activeJobs);
      active.delete(key);
    }
    if (active !== null) this._activeJobs = active;
    if (job.configuration) {
      this._markJobRecent(job);
    }
  }

  /** Hold a just-terminated job in `_recentJobs` so the dashboard can
   *  show a transient success/failure indicator. Replaces any prior
   *  recent entry (and timer) for the same device. */
  private _markJobRecent(job: FirmwareJob): void {
    const recent = new Map(this._recentJobs);
    recent.set(job.configuration, job);
    this._recentJobs = recent;

    const prevTimer = this._recentJobTimers.get(job.configuration);
    if (prevTimer !== undefined) clearTimeout(prevTimer);

    const ttl =
      job.status === JobStatus.COMPLETED
        ? RECENT_JOB_TTL_MS_COMPLETED
        : RECENT_JOB_TTL_MS_ATTENTION;
    const timer = setTimeout(() => {
      this._recentJobTimers.delete(job.configuration);
      // Only drop if this job is still the latest recent entry; a
      // newer terminate would have replaced it.
      if (this._recentJobs.get(job.configuration)?.job_id !== job.job_id) {
        return;
      }
      const next = new Map(this._recentJobs);
      next.delete(job.configuration);
      this._recentJobs = next;
    }, ttl);
    this._recentJobTimers.set(job.configuration, timer);
  }

  private _handleEvent(event: string, data: unknown): void {
    switch (event) {
      case DeviceEventType.INITIAL_STATE: {
        const { devices, importable } = data as InitialStateEventData;
        this._devices = devices;
        this._importableDevices = importable;
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
        const { device } = data as ImportableDeviceAddedEventData;
        // Upsert by name so the ignore-toggle's re-fire updates the
        // ``ignored`` flag in place; a fresh discovery falls through
        // the same path as an append.
        const idx = this._importableDevices.findIndex(
          (d) => d.name === device.name,
        );
        if (idx === -1) {
          this._importableDevices = [...this._importableDevices, device];
        } else {
          const next = [...this._importableDevices];
          next[idx] = device;
          this._importableDevices = next;
        }
        break;
      }
      case DeviceEventType.IMPORTABLE_DEVICE_REMOVED: {
        // Backend payload is ``{name: string}`` — the original
        // AdoptableDevice is already gone from ``import_result`` by
        // the time the event fires, and we only need the name to
        // drop the matching entry locally.
        const { name } = data as ImportableDeviceRemovedEventData;
        this._importableDevices = this._importableDevices.filter(
          (d) => d.name !== name,
        );
        break;
      }
    }
  }

  // ─── Render ──────────────────────────────────────────────

  @query("esphome-settings-dialog")
  private _settingsDialog!: ESPHomeSettingsDialog;

  @query("esphome-firmware-jobs-dialog")
  private _firmwareJobsDialog!: ESPHomeFirmwareJobsDialog;

  protected render() {
    return html`
      <esphome-layout
        @set-theme=${this._onSetTheme}
        @set-yaml-diff-button=${this._onSetYamlDiffButton}
        @set-language=${this._onSetLanguage}
        @open-settings=${this._onOpenSettings}
        @open-firmware-jobs=${this._onOpenFirmwareJobs}
      >
        ${this._router.outlet()}
      </esphome-layout>
      <esphome-command-palette
        @set-theme=${this._onSetTheme}
        @set-yaml-diff-button=${this._onSetYamlDiffButton}
        @set-language=${this._onSetLanguage}
      ></esphome-command-palette>
      <esphome-settings-dialog
        @set-theme=${this._onSetTheme}
        @set-yaml-diff-button=${this._onSetYamlDiffButton}
        @set-language=${this._onSetLanguage}
      ></esphome-settings-dialog>
      <esphome-firmware-jobs-dialog
        @firmware-history-cleared=${this._onFirmwareHistoryCleared}
      ></esphome-firmware-jobs-dialog>
    `;
  }

  private _onSetTheme(e: CustomEvent<string>) {
    const theme = e.detail as Theme;
    this._applyTheme(theme);
    this._api.updatePreferences({ theme }).catch(() => {});
  }

  private _onSetYamlDiffButton(e: CustomEvent<boolean>) {
    const enabled = e.detail;
    this._yamlDiffButton = enabled;
    this._api.updatePreferences({ yaml_diff_button: enabled }).catch(() => {});
  }

  private async _onSetLanguage(
    e: CustomEvent<SupportedLocale | "system">
  ) {
    const choice = e.detail;
    if (choice === "system") {
      clearStoredLocale();
    } else {
      writeStoredLocale(choice);
    }
    try {
      // Pass undefined when "system" so loadLocalize falls back to browser detection.
      this._localize = await loadLocalize(
        choice === "system" ? undefined : choice
      );
    } catch (err) {
      console.error("Failed to load locale", choice, err);
    }
  }

  private _onOpenSettings() {
    this._settingsDialog?.open();
  }

  private _onOpenFirmwareJobs() {
    this._firmwareJobsDialog?.open();
  }

  /** Prune retained terminal jobs locally after the user clears
   *  history — `firmware/clear` doesn't broadcast an event. */
  private _onFirmwareHistoryCleared() {
    const next = new Map<string, FirmwareJob>();
    for (const [id, job] of this._firmwareJobs) {
      if (!TERMINAL_STATUSES.has(job.status)) {
        next.set(id, job);
      }
    }
    this._firmwareJobs = next;
    this._clearRecentJobs();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-app": ESPHomeApp;
  }
}
