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
import {
  isOnboardingPending,
  shouldAutoShowOnboarding,
} from "../util/onboarding-gate.js";
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
  OffloaderAlertSnapshotEntry,
  OffloaderPairAlertDismissedEventData,
  OffloaderPairPeerRevokedEventData,
  OffloaderPairPinMismatchEventData,
  OffloaderPairStatusChangedEventData,
  PairingSummary,
  PairingWindowState,
  PeerSummary,
  ReceiverPeerLinkSessionEventData,
  RemoteBuildHostAddedEventData,
  RemoteBuildHostRemovedEventData,
  RemoteBuildPairingWindowChangedEventData,
  RemoteBuildPairRequestReceivedEventData,
  RemoteBuildPairStatusChangedEventData,
  RemoteBuildPeer,
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
  buildOffloadAlertsContext,
  buildOffloadDiscoveredHostsContext,
  buildOffloadPairingsContext,
  buildServerIdentityRotationCounterContext,
  buildServerPairingWindowStateContext,
  buildServerPeersContext,
  recentJobsContext,
  firmwareJobsContext,
  importableDevicesContext,
  integrationDocsContext,
  isHaIngressContext,
  labelsContext,
  localizeContext,
  onboardingPendingContext,
  remoteBuildEnabledContext,
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
import "./onboarding-wifi-dialog.js";
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

  // Receiver-side master switch for the remote-build feature
  // (issue #106 phase 2). Loaded from the backend on (re)connect;
  // updated when the user toggles ``Settings → Remote builder``.
  // Phase 2 only persists the flag — phase 3 wires the
  // ``/remote-build/v1/*`` route registration to it.
  @provide({ context: remoteBuildEnabledContext })
  @state()
  private _remoteBuildEnabled = false;

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

  /** True when onboarding has any data-derived ``pending`` step.
   *  Derived in ``_loadOnboardingState`` from
   *  ``onboarding/get_state``. Surfaced to header-actions to gate
   *  the conditional ``Set up Wi-Fi…`` kebab entry. Dialog
   *  visibility uses a separate signal (acknowledged-version +
   *  session-dismissal) — this context is the always-on data
   *  signal that should outlive any dismissal. */
  @provide({ context: onboardingPendingContext })
  @state()
  private _onboardingPending = false;

  /** Counter incremented on every ``remote_build_identity_rotated``
   *  event. The Build server Settings card watches this through
   *  the matching context and re-fetches its identity when the
   *  value changes, so a rotation triggered in another tab
   *  refreshes here without a manual reload. */
  @provide({ context: buildServerIdentityRotationCounterContext })
  @state()
  private _buildServerIdentityRotationCounter = 0;

  /** Receiver-side peer list (PENDING + APPROVED). Seeded from
   *  the ``initial_state.peers`` snapshot the backend pushes
   *  once at subscribe time; mutated locally as
   *  ``remote_build_pair_request_received`` (upsert) and
   *  ``remote_build_pair_status_changed`` (status flip / row
   *  drop) events arrive. ``null`` until the snapshot lands so
   *  consumers can distinguish "no controller / still loading"
   *  from "loaded with zero rows". Phase 4b-2 (#106). */
  @provide({ context: buildServerPeersContext })
  @state()
  private _buildServerPeers: PeerSummary[] | null = null;

  /** Latest receiver-side pairing-window state. ``null`` until
   *  the first ``remote_build_pairing_window_changed`` event lands
   *  (or until the Settings dialog's Build server section runs
   *  its initial ``setRemoteBuildPairingWindow`` call). The
   *  Settings UI renders an open/closed status pill plus the
   *  remaining lifetime when open. Phase 4b-2 (#106). */
  @provide({ context: buildServerPairingWindowStateContext })
  @state()
  private _buildServerPairingWindowState: PairingWindowState | null = null;

  /** mDNS-discovered offload-target dashboards, keyed on the
   *  service-instance ``name`` for fast upsert / delete and
   *  insertion-ordered iteration. Seeded from
   *  ``initial_state.hosts`` on subscribe; live updates flow
   *  through ``REMOTE_BUILD_HOST_ADDED`` (upsert) /
   *  ``REMOTE_BUILD_HOST_REMOVED`` (drop). Replaces the deleted
   *  ``listRemoteBuildHosts`` pull surface. ``null`` until the
   *  initial-state snapshot lands so consumers can distinguish
   *  "no controller / still loading" from "loaded with zero
   *  rows". A :class:`Map` (not a plain object) avoids the
   *  ``__proto__``/``constructor`` key collision a malicious
   *  mDNS responder could trigger and the
   *  numeric-key reordering plain objects do during
   *  enumeration. */
  @provide({ context: buildOffloadDiscoveredHostsContext })
  @state()
  private _buildOffloadDiscoveredHosts: Map<string, RemoteBuildPeer> | null =
    null;

  /** Offloader-side pairings (PENDING + APPROVED), keyed on
   *  ``${hostname}:${port}`` (matches the backend's
   *  ``StoredPairing`` key — receiver `dashboard_id` isn't
   *  visible offloader-side, so the receiver coordinates the
   *  user typed are the stable id). Seeded from
   *  ``initial_state.pairings``; mutated locally on
   *  ``OFFLOADER_PAIR_STATUS_CHANGED`` (status flip on
   *  ``"approved"``, drop on ``"removed"``). The Send-builds
   *  Settings subsection reads this directly to render the
   *  paired-receivers list, and the pair dialog reads it to
   *  auto-close on a matching event after a sent
   *  ``request_pair``. ``Map`` for the same reasons
   *  ``_buildOffloadDiscoveredHosts`` is: keys are
   *  user/network-supplied strings, insertion order needs to
   *  be stable, and ``Map`` avoids the
   *  ``__proto__``/``constructor`` key collisions a plain
   *  object would have on those keys. ``null`` until the
   *  snapshot lands. */
  @provide({ context: buildOffloadPairingsContext })
  @state()
  private _buildOffloadPairings: Map<string, PairingSummary> | null = null;

  /** Offloader-side pair alerts keyed on ``${hostname}:${port}``.
   *  Populated by ``OFFLOADER_PAIR_PIN_MISMATCH`` /
   *  ``OFFLOADER_PAIR_PEER_REVOKED`` (upsert by key) and
   *  cleared by ``OFFLOADER_PAIR_ALERT_DISMISSED`` (drop by
   *  key); seeded from ``initial_state.offloader_alerts``
   *  on subscribe. RAM-only on the backend, RAM-only here.
   *  ``null`` until the snapshot lands so consumers can
   *  distinguish "no controller / still loading" from
   *  "loaded with zero alerts". */
  @provide({ context: buildOffloadAlertsContext })
  @state()
  private _buildOffloadAlerts: Map<string, OffloaderAlertSnapshotEntry> | null =
    null;

  /** True when the onboarding wizard should be shown. Computed
   *  from ``completed_version < current_version`` AND not
   *  session-dismissed. Session-only ``"maybe later"`` flips
   *  ``_onboardingSessionDismissed`` so the dialog stays closed
   *  until the next dashboard load; explicit decline / save call
   *  ``mark_acknowledged`` on the backend so the dialog stops
   *  re-popping until a future onboarding-version bump. */
  @state()
  private _onboardingShouldShow = false;

  /** Frontend-only "maybe later" — closes the dialog without
   *  POSTing acknowledgement. Reset on next page load. */
  @state()
  private _onboardingSessionDismissed = false;

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
    // ``secrets-saved`` is dispatched on ``window`` by every code
    // path that writes ``secrets.yaml`` (the secrets editor, the
    // onboarding wizard). Refresh the onboarding snapshot so the
    // kebab "Set up Wi-Fi" entry tracks the on-disk state in real
    // time regardless of which surface initiated the write.
    window.addEventListener("secrets-saved", this._onSecretsSaved);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._api.disconnect();
    this._clearRecentJobs();
    if ("serial" in navigator) {
      navigator.serial.removeEventListener("connect", this._onSerialConnect);
    }
    window.removeEventListener("secrets-saved", this._onSecretsSaved);
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
    this._loadRemoteBuildSettings();
    this._loadOnboardingState();
  }

  /** Load the onboarding snapshot and update both the
   *  always-on data signal (``_onboardingPending`` — gates the
   *  ``Set up Wi-Fi…`` kebab entry in header-actions) and the
   *  dialog-show signal (``_onboardingShouldShow`` — auto-pop
   *  requires acknowledged-version-behind AND a pending step
   *  AND no session-dismissal; see ``shouldAutoShowOnboarding``
   *  for the full predicate). Re-runs on reconnect and after
   *  every secrets save; the dialog doesn't re-open mid-session
   *  because ``_onboardingSessionDismissed`` survives the
   *  refresh. The kebab entry is the manual override for users
   *  who want the wizard outside of the auto-pop conditions. */
  private async _loadOnboardingState() {
    try {
      const state = await this._api.getOnboardingState();
      this._onboardingPending = isOnboardingPending(state);
      this._onboardingShouldShow = shouldAutoShowOnboarding(
        state,
        this._onboardingSessionDismissed,
      );
    } catch (err) {
      // Onboarding is non-critical — a transient WS failure here
      // shouldn't block the rest of the dashboard. Clear the
      // badge (the latest data is unknown, so reading as "no
      // nudge" is safer than a stale red dot) but leave the
      // dialog-show signal alone: a transient reload on a
      // session-dismissed state must not cause a false→true
      // transition that re-opens the wizard the user just
      // closed. ``_onboardingSessionDismissed`` already prevents
      // the *next* successful load from re-opening, but only if
      // we don't toggle the show signal in between.
      console.warn("Failed to load onboarding state:", err);
      this._onboardingPending = false;
    }
  }

  private _onOnboardingAcknowledged = () => {
    // Triggered by the dialog after a successful save or explicit
    // decline — both of which call ``mark_acknowledged`` on the
    // backend. Refresh the state so the badge reflects the new
    // data (cleared after a save) and so the dialog signal stays
    // accurate without another full round-trip on the user's
    // next page load.
    this._onboardingShouldShow = false;
    this._loadOnboardingState();
  };

  private _onOnboardingDismissedSession = () => {
    this._onboardingSessionDismissed = true;
    this._onboardingShouldShow = false;
  };

  /** User picked the "Set up Wi-Fi" kebab item. Re-launches the
   *  wizard regardless of acknowledged-version / session-dismiss
   *  — the kebab entry is the explicit "I want to do this now"
   *  signal, so we override both gates. */
  private _onOpenOnboarding = () => {
    this._onboardingSessionDismissed = false;
    this._onboardingDialog?.open();
  };

  /** Secrets editor finished a save. Refresh the onboarding
   *  snapshot so the kebab entry appears / disappears in real
   *  time when the user clears or fills in Wi-Fi credentials by
   *  hand instead of going through the wizard. */
  private _onSecretsSaved = () => {
    this._loadOnboardingState();
  };

  // True while a ``setRemoteBuildSettings`` write is in flight. The
  // reload path on (re)connect skips when this is set so a write
  // racing with an auto-reconnect can't get clobbered by the
  // server-side pre-toggle value.
  private _remoteBuildSetInFlight = false;

  private async _loadRemoteBuildSettings() {
    // Receiver-side remote-build settings (issue #106 phase 2).
    // The frontend is shipped bundled with the backend wheel, so
    // every backend on the wire already knows these commands —
    // no older-version path. A real failure here is a transient
    // (broken WS, server bug), logged so it isn't silently
    // masking ``false`` when the actual state is ``true``.
    if (this._remoteBuildSetInFlight) {
      // A user-initiated write is racing with this reload. Skip —
      // the optimistic value is the source of truth until the
      // write completes; the post-write state is what should
      // persist, not the pre-write server snapshot.
      return;
    }
    try {
      const settings = await this._api.getRemoteBuildSettings();
      this._remoteBuildEnabled = settings.enabled;
    } catch (err) {
      console.warn("Could not load remote-build settings:", err);
    }
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
        const {
          devices,
          importable,
          peers,
          hosts,
          pairings,
          offloader_alerts,
        } = data as InitialStateEventData;
        this._devices = devices;
        this._importableDevices = importable;
        this._devicesLoaded = true;
        // ``peers`` / ``hosts`` / ``pairings`` are optional —
        // backend omits the fields when no remote-build
        // controller is wired up. ``[]`` would imply "controller
        // present, no rows" which is a distinct state. Default
        // to ``null`` (still / not loading) when absent.
        this._buildServerPeers = peers ?? null;
        this._buildOffloadDiscoveredHosts =
          hosts === undefined
            ? null
            : new Map(hosts.map((h) => [h.name, h]));
        this._buildOffloadPairings =
          pairings === undefined
            ? null
            : new Map(
                pairings.map((p) => [
                  this._pairingKey(p.receiver_hostname, p.receiver_port),
                  p,
                ]),
              );
        this._buildOffloadAlerts =
          offloader_alerts === undefined
            ? null
            : new Map(
                offloader_alerts.map((a) => [
                  this._pairingKey(a.receiver_hostname, a.receiver_port),
                  a,
                ]),
              );
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
      case DeviceEventType.REMOTE_BUILD_IDENTITY_ROTATED: {
        // Bump the counter. Settings dialog watches the matching
        // context and re-fetches identity when the value changes,
        // so a rotation triggered in another tab refreshes the
        // visible cert fingerprint here.
        this._buildServerIdentityRotationCounter += 1;
        break;
      }
      case DeviceEventType.REMOTE_BUILD_PAIR_REQUEST_RECEIVED: {
        // Upsert a PENDING row keyed on ``dashboard_id``. Carries
        // every field needed for a complete ``PeerSummary``-shape
        // (the receiver fires this event with ``paired_at`` and
        // ``peer_ip`` so the frontend doesn't need a follow-up
        // read). A re-pair by the same offloader before admin
        // clicked Accept lands a fresh event with the new pin /
        // pubkey / paired_at / peer_ip; upsert overwrites in
        // place. ``peer_ip`` is display-only — the inbox renders
        // it as a clone-risk sanity-check, no decision logic
        // keys on it.
        const evt = data as RemoteBuildPairRequestReceivedEventData;
        const incoming: PeerSummary = {
          dashboard_id: evt.dashboard_id,
          pin_sha256: evt.pin_sha256,
          label: evt.label,
          paired_at: evt.paired_at,
          status: "pending",
          peer_ip: evt.peer_ip,
          // PENDING peers are always offline; peer-link is gated
          // on APPROVED status server-side via
          // ``lookup_peer_for_session``, so the receiver won't
          // register a session for this row until admin accepts.
          connected: false,
        };
        const current = this._buildServerPeers ?? [];
        const idx = current.findIndex(
          (p) => p.dashboard_id === incoming.dashboard_id
        );
        this._buildServerPeers =
          idx === -1
            ? [...current, incoming]
            : [...current.slice(0, idx), incoming, ...current.slice(idx + 1)];
        break;
      }
      case DeviceEventType.REMOTE_BUILD_PAIR_STATUS_CHANGED: {
        // Two cases keyed on ``status``:
        // - ``approved``: flip the matching row's ``status`` from
        //   pending to approved. The other fields stay valid (no
        //   command mutates an APPROVED row in production today;
        //   the receiver event carries only dashboard_id +
        //   status by design).
        // - ``removed``: drop the row. Reaches the frontend when
        //   admin clicked Remove or when the pairing-window
        //   auto-close cleared a stale PENDING entry.
        const evt = data as RemoteBuildPairStatusChangedEventData;
        const current = this._buildServerPeers ?? [];
        if (evt.status === "removed") {
          this._buildServerPeers = current.filter(
            (p) => p.dashboard_id !== evt.dashboard_id
          );
        } else {
          this._buildServerPeers = current.map((p) =>
            p.dashboard_id === evt.dashboard_id
              ? { ...p, status: "approved" as const }
              : p
          );
        }
        break;
      }
      case DeviceEventType.RECEIVER_PEER_LINK_SESSION_OPENED:
      case DeviceEventType.RECEIVER_PEER_LINK_SESSION_CLOSED: {
        // Flip ``connected`` on the matching APPROVED row.
        // Both events share the same payload shape; the
        // discriminator is the event type itself.
        // ``_buildServerPeers`` may be ``null`` (snapshot not
        // yet seeded) or missing the row entirely (event raced
        // ahead of the snapshot, or fired against a peer the
        // backend just dropped). In both cases the next
        // ``initial_state`` reseed carries the right state, so
        // skip rather than synthesise a partial row.
        if (this._buildServerPeers === null) {
          break;
        }
        const evt = data as ReceiverPeerLinkSessionEventData;
        const connected =
          event === DeviceEventType.RECEIVER_PEER_LINK_SESSION_OPENED;
        this._buildServerPeers = this._buildServerPeers.map((p) =>
          p.dashboard_id === evt.dashboard_id ? { ...p, connected } : p
        );
        break;
      }
      case DeviceEventType.REMOTE_BUILD_PAIRING_WINDOW_CHANGED: {
        // Mirror the receiver's pairing-window state directly.
        // The event payload IS the state shape, so the assignment
        // is a passthrough.
        this._buildServerPairingWindowState =
          data as RemoteBuildPairingWindowChangedEventData;
        break;
      }
      case DeviceEventType.REMOTE_BUILD_HOST_ADDED: {
        // Upsert a discovered-host row keyed on ``name`` (the
        // mDNS service-instance label). The same event fires for
        // both the cache-hit branch and the async resolve-success
        // branch on the backend, plus on TXT refreshes mid-
        // session, so overwrite-by-name handles all three paths.
        // ``Map.set`` preserves the existing insertion position
        // for an already-present key, so a TXT refresh on an
        // existing host doesn't shuffle the rendered order.
        const evt = data as RemoteBuildHostAddedEventData;
        const next = new Map(this._buildOffloadDiscoveredHosts ?? []);
        next.set(evt.name, evt);
        this._buildOffloadDiscoveredHosts = next;
        break;
      }
      case DeviceEventType.REMOTE_BUILD_HOST_REMOVED: {
        // Drop the row keyed on ``name``. Backend only fires this
        // when ``self._peers.pop`` actually returned a row, so
        // unknown-name events would already be filtered server-
        // side; the ``delete`` here is the immutable mutation
        // (clone, then drop) Lit needs to re-render.
        const evt = data as RemoteBuildHostRemovedEventData;
        if (this._buildOffloadDiscoveredHosts === null) {
          break;
        }
        const next = new Map(this._buildOffloadDiscoveredHosts);
        next.delete(evt.name);
        this._buildOffloadDiscoveredHosts = next;
        break;
      }
      case DeviceEventType.OFFLOADER_PAIR_STATUS_CHANGED: {
        // Two cases keyed on ``status``:
        // - ``approved``: flip the matching pairing row's status
        //   to "approved". Other fields stay valid (the receiver-
        //   side approval doesn't mutate label / pin / paired_at;
        //   the row's identity is the receiver coordinates the
        //   user typed). If the row isn't in the map yet (event
        //   raced ahead of the snapshot), skip the flip — the
        //   next initial-state push reseeds.
        // - ``removed``: drop the row by key. ``unpair`` /
        //   receiver-side reject / receiver-rotated-out-from-
        //   under-us all funnel through this event.
        const evt = data as OffloaderPairStatusChangedEventData;
        if (this._buildOffloadPairings === null) {
          break;
        }
        const key = this._pairingKey(
          evt.receiver_hostname,
          evt.receiver_port,
        );
        const next = new Map(this._buildOffloadPairings);
        if (evt.status === "removed") {
          next.delete(key);
        } else {
          const existing = next.get(key);
          if (existing === undefined) {
            break;
          }
          next.set(key, { ...existing, status: "approved" });
        }
        this._buildOffloadPairings = next;
        break;
      }
      case DeviceEventType.OFFLOADER_PAIR_PIN_MISMATCH: {
        // Backend's pair-status listener detected the receiver's
        // static X25519 pubkey hash drifted from what the
        // offloader had on disk. Upsert the alert keyed on
        // ``${hostname}:${port}`` (overwrites any prior alert
        // for the same row — only one alert per receiver, the
        // most recent detection wins). Same key shape as the
        // backend's ``_offloader_alerts`` dict so the snapshot
        // and the live event both target the same map slot.
        const evt = data as OffloaderPairPinMismatchEventData;
        const key = this._pairingKey(
          evt.receiver_hostname,
          evt.receiver_port,
        );
        const next = new Map(this._buildOffloadAlerts ?? []);
        next.set(key, {
          kind: "pin_mismatch",
          receiver_hostname: evt.receiver_hostname,
          receiver_port: evt.receiver_port,
          receiver_label: evt.receiver_label,
          expected_pin: evt.expected_pin,
          observed_pin: evt.observed_pin,
          fired_at: Date.now() / 1000,
        });
        this._buildOffloadAlerts = next;
        break;
      }
      case DeviceEventType.OFFLOADER_PAIR_PEER_REVOKED: {
        // Receiver returned ``rejected`` on the pair-status
        // long-poll. Same upsert pattern as pin_mismatch, just
        // a different ``kind`` discriminator.
        const evt = data as OffloaderPairPeerRevokedEventData;
        const key = this._pairingKey(
          evt.receiver_hostname,
          evt.receiver_port,
        );
        const next = new Map(this._buildOffloadAlerts ?? []);
        next.set(key, {
          kind: "peer_revoked",
          receiver_hostname: evt.receiver_hostname,
          receiver_port: evt.receiver_port,
          receiver_label: evt.receiver_label,
          fired_at: Date.now() / 1000,
        });
        this._buildOffloadAlerts = next;
        break;
      }
      case DeviceEventType.OFFLOADER_PAIR_ALERT_DISMISSED: {
        // Backend dropped the alert via one of the resolution
        // paths (``request_pair`` succeeded for matching
        // ``(host, port)``, or ``unpair`` removed the row).
        // Drop the local row to match.
        const evt = data as OffloaderPairAlertDismissedEventData;
        if (this._buildOffloadAlerts === null) {
          break;
        }
        const key = this._pairingKey(
          evt.receiver_hostname,
          evt.receiver_port,
        );
        const next = new Map(this._buildOffloadAlerts);
        next.delete(key);
        this._buildOffloadAlerts = next;
        break;
      }
    }
  }

  /** Compose the pairings-map key from receiver coordinates.
   *
   *  ``${hostname}:${port}`` matches the backend's
   *  ``StoredPairing`` key shape. Hostname is lowercase already
   *  (backend normalises to RFC 1035 §2.3.3 on persist), so a
   *  case-flip on either side wouldn't desync the lookup. */
  private _pairingKey(hostname: string, port: number): string {
    return `${hostname}:${port}`;
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
        @open-onboarding-wifi=${this._onOpenOnboarding}
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
        @set-remote-build-enabled=${this._onSetRemoteBuildEnabled}
        @set-language=${this._onSetLanguage}
        @pair-request-sent=${this._onPairRequestSent}
      ></esphome-settings-dialog>
      <esphome-firmware-jobs-dialog
        @firmware-history-cleared=${this._onFirmwareHistoryCleared}
      ></esphome-firmware-jobs-dialog>
      <esphome-feedback-dialog></esphome-feedback-dialog>
      <esphome-onboarding-wifi-dialog
        @onboarding-acknowledged=${this._onOnboardingAcknowledged}
        @onboarding-dismissed-session=${this._onOnboardingDismissedSession}
      ></esphome-onboarding-wifi-dialog>
    `;
  }

  /** When ``_onboardingShouldShow`` flips true, programmatically
   *  open the dialog. The dialog itself is mounted unconditionally
   *  (so the ``@`` event listeners are wired) but starts closed. */
  protected updated(changed: Map<string | number | symbol, unknown>) {
    super.updated?.(changed);
    if (changed.has("_onboardingShouldShow") && this._onboardingShouldShow) {
      this._onboardingDialog?.open();
    }
  }

  @query("esphome-onboarding-wifi-dialog")
  private _onboardingDialog?: HTMLElement & { open(): void };

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

  private async _onSetRemoteBuildEnabled(e: CustomEvent<boolean>) {
    // Optimistic flip — keeps the toggle's visual state in sync
    // with the click. The backend round-trip happens after; if it
    // fails we revert the optimistic value and surface a toast so
    // the user sees their security-sensitive toggle didn't take
    // effect (silent UI / disk divergence on a "trust this peer"
    // toggle is a real bug, not a polish item).
    //
    // ``_remoteBuildSetInFlight`` gates ``_loadRemoteBuildSettings``
    // so a reconnect that lands mid-write can't clobber the
    // optimistic value with the pre-toggle server snapshot.
    const enabled = e.detail;
    const previous = this._remoteBuildEnabled;
    this._remoteBuildEnabled = enabled;
    this._remoteBuildSetInFlight = true;
    try {
      await this._api.setRemoteBuildSettings({ enabled });
      // Toggling ``enabled`` runs ``apply_remote_build_enabled``
      // on the backend, which tears down or re-binds the peer-
      // link runner; ``IdentityView.listener_bound`` flips
      // alongside. The cached identity in settings-dialog goes
      // stale immediately, so bump the counter to force a
      // re-fetch and pick up the fresh ``listener_bound`` (plus
      // any version fields that depend on the bound state).
      // Without this the "Listener active / down" indicator
      // would render whatever ``listener_bound`` was at the
      // last fetch, ignoring the toggle the user just clicked.
      this._buildServerIdentityRotationCounter += 1;
    } catch {
      this._remoteBuildEnabled = previous;
      toast.error(
        this._localize("settings.remote_build_save_failed"),
        { richColors: true }
      );
    } finally {
      this._remoteBuildSetInFlight = false;
    }
  }

  /** Upsert a freshly-created pairing into the offloader
   *  pairings map.
   *
   *  Fired by the pair-build-server dialog after a successful
   *  ``request_pair``. The backend persists the row but doesn't
   *  fire ``OFFLOADER_PAIR_STATUS_CHANGED`` for the create
   *  (events only mark status flips), so the dialog's
   *  auto-close watcher needs the row in the map locally as a
   *  baseline for the next event. The ``PairingSummary``
   *  shape here is identical to what
   *  ``initial_state.pairings`` carries, so re-using the same
   *  ``${hostname}:${port}`` key keeps snapshot and live-event
   *  paths aligned. */
  private _onPairRequestSent(
    e: CustomEvent<{ summary: PairingSummary }>,
  ): void {
    const summary = e.detail.summary;
    const key = this._pairingKey(
      summary.receiver_hostname,
      summary.receiver_port,
    );
    const next = new Map(this._buildOffloadPairings ?? []);
    next.set(key, summary);
    this._buildOffloadPairings = next;
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
