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
import { APIError, ESPHomeAPI } from "../api/index.js";
import {
  DeviceEventType,
  DeviceState,
  ErrorCode,
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
  Label,
  LabelDeletedEventData,
  LabelEventData,
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
  labelsContext,
  localizeContext,
  serverVersionContext,
  versionContext,
  yamlDiffButtonContext,
} from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { BASE_PATH, withBase } from "../util/base-path.js";
import { isTerminalJobStatus } from "../util/firmware-job-status.js";

// Mirrors the backend's `_PRIMARY_JOB_TYPES` retention pool — these
// are the job types deduplicated to one terminal entry per device.
const PRIMARY_JOB_TYPES: ReadonlySet<JobType> = new Set([
  JobType.COMPILE,
  JobType.UPLOAD,
  JobType.INSTALL,
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
import "./esphome-login.js";
import "./feedback-dialog.js";
import type { ESPHomeFeedbackDialog } from "./feedback-dialog.js";
import "./firmware-jobs-dialog.js";
import type { ESPHomeFirmwareJobsDialog } from "./firmware-jobs-dialog.js";
import "./settings-dialog.js";
import type { ESPHomeSettingsDialog } from "./settings-dialog.js";

type AuthState = "connecting" | "needs-login" | "authing" | "authed";

/** Parse the "try again in Xs" hint out of the backend's rate-limit
 *  details string. Returns 0 when no number is present so the caller
 *  can fall back to a generic "try again later" message. */
function parseRateLimitSeconds(details: string): number {
  const match = /in\s+(\d+)\s*s/.exec(details);
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Decode the ``:id`` path param for the device route, falling back to
 *  the raw value when the URL contains a malformed ``%`` sequence.
 *
 *  ``decodeURIComponent`` raises ``URIError`` on inputs like ``%E0``
 *  (a partial UTF-8 byte) or any lone ``%``; that would crash the
 *  router and blank the whole app. Falling back to the raw param
 *  lets the device-list lookup miss naturally and the device page
 *  shows its "not found" empty state — the correct UX for a
 *  hand-crafted broken URL. */
function decodeIdParam(id: string | undefined): string {
  if (!id) return "";
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

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

  @provide({ context: serverVersionContext })
  @state()
  private _serverVersion = "";

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

  /** Global label catalog. Fetched once on (re)connect via
   *  ``labels/list`` and kept in sync by ``label_*`` events
   *  delivered through ``subscribe_events``. Empty until the
   *  fetch lands; consumers tolerate that — chip renderers
   *  silently drop unknown ids (``resolveLabelIds``) and the
   *  toolbar filter hides itself entirely on an empty catalog,
   *  so missing entries simply produce no visible UI. */
  @provide({ context: labelsContext })
  @state()
  private _labels: Label[] = [];

  // ─── Auth gate ───────────────────────────────────────────
  // Drives whether we render the connecting spinner, the login form,
  // or the actual app. Starts at "connecting" until the first
  // serverinfo lands; the API client either marks ``ready`` immediately
  // (no auth required) or fires ``onAuthRequired`` so we surface
  // ``<esphome-login>``.
  @state()
  private _authState: AuthState = "connecting";

  @state()
  private _authError: string | null = null;

  @state()
  private _rateLimitedUntil = 0;

  // Tracks the WebSocket connection independently from the auth gate.
  // We deliberately *do not* flip ``_authState`` on disconnect — that
  // would unmount the routed app on every transient blip and lose
  // page-local state like the device editor's unsaved YAML buffer.
  // Components that care (currently just the login form's submit
  // button) read this directly.
  @state()
  private _apiConnected = false;

  // ─── Router ──────────────────────────────────────────────

  private _router = new Router(this, [
    {
      path: withBase("/"),
      render: () => html`<esphome-page-dashboard></esphome-page-dashboard>`,
    },
    {
      path: withBase("/secrets"),
      enter: async () => {
        await import("../pages/secrets.js");
        return true;
      },
      render: () => html`<esphome-page-secrets></esphome-page-secrets>`,
    },
    {
      path: withBase("/device/:id"),
      enter: async () => {
        await import("../pages/device.js");
        return true;
      },
      render: ({ id }) =>
        // Decode the path param so the device page's
        // ``this._devices.find(d => d.configuration === this.id)``
        // comparison works against the raw filename on disk. The
        // browser's URL parser percent-encodes any non-ASCII path
        // segment regardless of whether the navigator pre-encoded,
        // so by the time the router matches, ``id`` is encoded.
        // Wrap in try/catch: ``decodeURIComponent`` raises
        // ``URIError`` on a malformed ``%`` sequence
        // (``/device/%E0`` from a hand-crafted URL would otherwise
        // crash the whole router). Fall back to the raw param —
        // the device-list lookup will miss and the page will show
        // its "device not found" empty state, which is the right
        // UX for a deliberately-broken URL.
        html`<esphome-page-device
          .id=${decodeIdParam(id)}
        ></esphome-page-device>`,
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

      .auth-status-screen {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        min-height: 100%;
        gap: var(--wa-space-m);
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }

      .auth-spinner {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        border: 3px solid color-mix(in srgb, var(--esphome-primary), transparent 80%);
        border-top-color: var(--esphome-primary);
        animation: auth-spin 0.9s linear infinite;
      }

      @keyframes auth-spin {
        to {
          transform: rotate(360deg);
        }
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
      toastOptions: {
        position: "bottom-right",
        richColors: true,
        duration: 4000,
        // The bottom-right toast can land on top of the device
        // editor's Save / Install buttons (issue #171). The X
        // gives the user a guaranteed dismissal that doesn't
        // depend on swipe — which mouse users discover late and
        // touchpad users may struggle with — and isn't gated on
        // the 4s auto-close timer. UX team may swap this for a
        // different placement later; the close affordance stays
        // useful regardless of where the toast moves.
        closeButton: true,
      },
    });
    this._initDarkMode();
    try {
      this._localize = await loadLocalize();
    } catch (err) {
      console.error("Failed to load localization, falling back to default:", err);
      this._localize = ((key: string, ..._args: unknown[]) => key) as LocalizeFunc;
    }

    // Set up connection callbacks. ServerInfo is safe to consume
    // pre-auth (it's the auth-gate input itself), but anything that
    // sends backend commands has to wait for ``api.ready``.
    this._api.onConnected = (info: ServerInfoMessage) => {
      this._version = info.esphome_version;
      this._serverVersion = info.server_version;
      this._isHaIngress = info.ha_addon && BASE_PATH.includes("/ingress");
      this._apiConnected = true;
      // ``api.ready`` resolves when the connection is usable — either
      // ``requires_auth: false``, or a stored token replay succeeds.
      // If neither path takes, ``onAuthRequired`` fires below and the
      // app shell flips to ``needs-login``; this await stays parked
      // until the user signs in, then resumes the post-auth setup.
      void this._api.ready.then(() => this._afterAuthenticated());
    };

    this._api.onAuthRequired = () => {
      this._authState = "needs-login";
      this._authError = null;
      this._rateLimitedUntil = 0;
    };

    this._api.onDisconnected = () => {
      console.warn("WebSocket disconnected, will auto-reconnect...");
      // Don't touch ``_authState`` — keeping the routed app mounted
      // during transparent reconnects preserves page-local state like
      // the device editor's unsaved YAML buffer. The login form (when
      // visible) reads ``_apiConnected`` to disable submit while the
      // socket is down.
      this._apiConnected = false;
    };

    // Connect to WebSocket
    try {
      await this._api.connect();
    } catch (err) {
      console.error("Failed to connect to WebSocket:", err);
    }
  }

  /** Runs once auth has succeeded for the current connection (or
   *  immediately when no auth is required). Idempotent across reconnects. */
  private async _afterAuthenticated() {
    this._authState = "authed";
    this._authError = null;
    this._subscribeToEvents();
    this._subscribeToFollowJobs();
    this._loadIntegrationDocs();
    this._loadLabels();
    this._loadThemePreference();
  }

  /** Fetch the global label catalog. Called on every (re)connect so
   *  a session that reconnects after a backend label change picks up
   *  the latest state — push events drive it day-to-day, but a
   *  reconnect crosses a window where events were dropped. A failure
   *  here is non-fatal: ``_labels`` stays at its previous value (or
   *  empty on first load); chip renderers silently drop unknown ids
   *  and the toolbar filter hides itself on an empty catalog, so the
   *  missing data simply produces no visible UI. */
  private async _loadLabels() {
    try {
      this._labels = await this._api.listLabels();
    } catch (err) {
      console.warn("Failed to load labels catalog:", err);
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
    if (isTerminalJobStatus(job.status)) return;
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
          !isTerminalJobStatus(j.status),
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
          isTerminalJobStatus(existing.status)
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
      case DeviceEventType.LABEL_CREATED: {
        const { label } = data as LabelEventData;
        if (!this._labels.some((l) => l.id === label.id)) {
          this._labels = [...this._labels, label];
        }
        break;
      }
      case DeviceEventType.LABEL_UPDATED: {
        // Upsert, not just replace — if the initial ``labels/list``
        // failed (or this client missed the matching ``LABEL_CREATED``
        // for any reason) the catalog can be missing this entry, and
        // a plain ``map`` would silently drop the update and leave the
        // catalog permanently incomplete until the next reconnect.
        const { label } = data as LabelEventData;
        const idx = this._labels.findIndex((l) => l.id === label.id);
        this._labels =
          idx === -1
            ? [...this._labels, label]
            : this._labels.map((l) => (l.id === label.id ? label : l));
        break;
      }
      case DeviceEventType.LABEL_DELETED: {
        const { label_id } = data as LabelDeletedEventData;
        this._labels = this._labels.filter((l) => l.id !== label_id);
        break;
      }
    }
  }

  // ─── Render ──────────────────────────────────────────────

  @query("esphome-settings-dialog")
  private _settingsDialog!: ESPHomeSettingsDialog;

  @query("esphome-firmware-jobs-dialog")
  private _firmwareJobsDialog!: ESPHomeFirmwareJobsDialog;

  @query("esphome-feedback-dialog")
  private _feedbackDialog!: ESPHomeFeedbackDialog;

  protected render() {
    if (this._authState === "connecting") {
      return html`
        <div class="auth-status-screen">
          <div class="auth-spinner" aria-hidden="true"></div>
          <p>${this._localize("auth.connecting")}</p>
        </div>
      `;
    }

    if (this._authState === "needs-login" || this._authState === "authing") {
      return html`
        <esphome-login
          ?submitting=${this._authState === "authing"}
          ?disconnected=${!this._apiConnected}
          .error=${this._authError}
          rate-limited-until=${this._rateLimitedUntil}
          @submit-credentials=${this._onLoginSubmit}
        ></esphome-login>
      `;
    }

    return html`
      <esphome-layout
        @set-theme=${this._onSetTheme}
        @set-yaml-diff-button=${this._onSetYamlDiffButton}
        @set-language=${this._onSetLanguage}
        @open-settings=${this._onOpenSettings}
        @open-firmware-jobs=${this._onOpenFirmwareJobs}
        @open-reset-build-env=${this._onOpenResetBuildEnv}
        @open-feedback=${this._onOpenFeedback}
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
      <esphome-feedback-dialog></esphome-feedback-dialog>
    `;
  }

  private async _onLoginSubmit(
    e: CustomEvent<{ username: string; password: string }>,
  ) {
    if (this._authState === "authing") return;
    this._authState = "authing";
    this._authError = null;
    try {
      await this._api.login(e.detail);
      // ``api.login`` already resolved ``api.ready`` — the
      // ``onConnected.then`` chain in ``_init`` will pick that up and
      // call ``_afterAuthenticated`` which flips the state to
      // ``authed``. Nothing else to do here.
    } catch (err) {
      this._authState = "needs-login";
      if (!this._apiConnected) {
        // Socket dropped mid-login. The form is already showing
        // "Reconnecting…" via the ``disconnected`` prop; surfacing a
        // stale "sign-in failed" toast on top of that would just be
        // noise — the auto-reconnect will land and the user can retry.
        this._authError = null;
        this._rateLimitedUntil = 0;
        return;
      }
      if (err instanceof APIError) {
        if (err.errorCode === ErrorCode.NOT_AUTHENTICATED) {
          this._authError = this._localize("auth.invalid_credentials");
          this._rateLimitedUntil = 0;
          return;
        }
        if (err.errorCode === ErrorCode.RATE_LIMITED) {
          const seconds = parseRateLimitSeconds(err.details);
          if (seconds > 0) {
            this._rateLimitedUntil = Date.now() + seconds * 1000;
            this._authError = this._localize("auth.rate_limited", {
              seconds,
            });
          } else {
            this._rateLimitedUntil = 0;
            this._authError = this._localize("auth.rate_limited_generic");
          }
          return;
        }
      }
      console.error("Unexpected sign-in error:", err);
      this._authError = this._localize("auth.unexpected_error");
      this._rateLimitedUntil = 0;
    }
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

  private _onOpenResetBuildEnv() {
    this._firmwareJobsDialog?.openResetBuildEnv();
  }

  private _onOpenFeedback() {
    this._feedbackDialog?.open();
  }

  /** Prune retained terminal jobs locally after the user clears
   *  history — `firmware/clear` doesn't broadcast an event. */
  private _onFirmwareHistoryCleared() {
    const next = new Map<string, FirmwareJob>();
    for (const [id, job] of this._firmwareJobs) {
      if (!isTerminalJobStatus(job.status)) {
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
