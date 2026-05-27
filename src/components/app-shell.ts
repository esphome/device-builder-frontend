import { provide } from "@lit/context";
import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import { ESPHomeAPI } from "../api/index.js";
import {
  CLEANUP_TTL_DEFAULT_SECONDS,
  JobStatus,
  Theme,
} from "../api/types.js";
import type {
  AdoptableDevice,
  ConfiguredDevice,
  FirmwareJob,
  Label,
  OffloaderAlertSnapshotEntry,
  PairingSummary,
  PairingWindowState,
  PeerSummary,
  RemoteBuildPeer,
  RemoteBuildSubmitTarget,
  ServerInfoMessage,
} from "../api/types.js";
import {
  defaultLocalize,
  loadLocalize,
  type LocalizeFunc,
} from "../common/localize.js";
import {
  apiContext,
  darkModeContext,
  devicesContext,
  devicesLoadedContext,
  activeJobsContext,
  buildOffloadAlertsContext,
  buildOffloadDiscoveredHostsContext,
  buildOffloadJobsContext,
  buildOffloadPairingsContext,
  offloaderRemoteBuildsEnabledContext,
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
  remoteBuildCleanupTtlContext,
  remoteBuildEnabledContext,
  serverVersionContext,
  versionContext,
  yamlDiffButtonContext,
} from "../context/index.js";
import type { RemoteBuildJobState } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { BASE_PATH } from "../util/base-path.js";
import {
  isRecentSerialActivity,
  markSerialActivity,
} from "../util/web-serial.js";
import {
  loadIntegrationDocs,
  loadLabels,
  loadOnboardingState,
  loadRemoteBuildSettings,
  loadThemePreference,
} from "./app-shell/data-load.js";
import { handleEvent } from "./app-shell/events.js";
import {
  clearRecentJobs,
  onFirmwareHistoryCleared,
  subscribeToFollowJobs,
} from "./app-shell/jobs.js";
import { onLoginSubmit } from "./app-shell/auth.js";
import { createRouter } from "./app-shell/router.js";
import {
  onPairRequestSent,
  onRemoteBuildJobDismissed,
  onRemoteBuildJobSubmitted,
  onSetLanguage,
  onSetOffloaderPairingEnabled,
  onSetOffloaderRemoteBuildsEnabled,
  onSetRemoteBuildCleanupTtl,
  onSetRemoteBuildEnabled,
  onSetTheme,
  onSetYamlDiffButton,
} from "./app-shell/settings-actions.js";

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

export type AuthState = "connecting" | "needs-login" | "authing" | "authed";

@customElement("esphome-app")
export class ESPHomeApp extends LitElement {
  @provide({ context: apiContext }) _api = new ESPHomeAPI();
  @provide({ context: devicesContext }) @state() _devices: ConfiguredDevice[] = [];
  @provide({ context: importableDevicesContext }) @state() _importableDevices: AdoptableDevice[] = [];
  @provide({ context: devicesLoadedContext }) @state() _devicesLoaded = false;
  @provide({ context: versionContext }) @state() _version = "";
  @provide({ context: serverVersionContext }) @state() _serverVersion = "";
  @provide({ context: darkModeContext }) @state() _darkMode = false;
  @provide({ context: isHaIngressContext }) @state() _isHaIngress = false;
  @provide({ context: activeJobsContext }) @state() _activeJobs: Map<string, FirmwareJob> = new Map();
  @provide({ context: recentJobsContext }) @state() _recentJobs: Map<string, FirmwareJob> = new Map();
  @provide({ context: firmwareJobsContext }) @state() _firmwareJobs: Map<string, FirmwareJob> = new Map();
  @provide({ context: localizeContext }) @state() _localize: LocalizeFunc = defaultLocalize;
  @provide({ context: yamlDiffButtonContext }) @state() _yamlDiffButton = false;
  @provide({ context: remoteBuildEnabledContext }) @state() _remoteBuildEnabled = false;
  @provide({ context: remoteBuildCleanupTtlContext }) @state() _remoteBuildCleanupTtl = CLEANUP_TTL_DEFAULT_SECONDS;
  @provide({ context: integrationDocsContext }) @state() _integrationDocs: Record<string, string> = {};
  @provide({ context: labelsContext }) @state() _labels: Label[] = [];
  @provide({ context: onboardingPendingContext }) @state() _onboardingPending = false;
  @provide({ context: buildServerIdentityRotationCounterContext }) @state() _buildServerIdentityRotationCounter = 0;
  @provide({ context: buildServerPeersContext }) @state() _buildServerPeers: PeerSummary[] | null = null;
  @provide({ context: buildServerPairingWindowStateContext }) @state() _buildServerPairingWindowState: PairingWindowState | null = null;
  @provide({ context: buildOffloadDiscoveredHostsContext }) @state() _buildOffloadDiscoveredHosts: Map<string, RemoteBuildPeer> | null = null;
  @provide({ context: buildOffloadPairingsContext }) @state() _buildOffloadPairings: Map<string, PairingSummary> | null = null;
  @provide({ context: offloaderRemoteBuildsEnabledContext }) @state() _offloaderRemoteBuildsEnabled: boolean | null = null;
  @provide({ context: buildOffloadAlertsContext }) @state() _buildOffloadAlerts: Map<string, OffloaderAlertSnapshotEntry> | null = null;
  @provide({ context: buildOffloadJobsContext }) @state() _buildOffloadJobs: Map<string, RemoteBuildJobState> = new Map();

  @state() _onboardingShouldShow = false;
  @state() _onboardingSessionDismissed = false;
  @state() _authState: AuthState = "connecting";
  @state() _authError: string | null = null;
  @state() _rateLimitedUntil = 0;
  // Tracks the WS connection independently from auth — we don't flip _authState
  // on disconnect, that would unmount routed pages and lose unsaved YAML buffers.
  @state() _apiConnected = false;

  _recentJobTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  _remoteBuildSetInFlight = false;

  private _router = createRouter(this);

  @query("esphome-settings-dialog") private _settingsDialog!: ESPHomeSettingsDialog;
  @query("esphome-firmware-jobs-dialog") private _firmwareJobsDialog!: ESPHomeFirmwareJobsDialog;
  @query("esphome-feedback-dialog") private _feedbackDialog!: ESPHomeFeedbackDialog;
  @query("esphome-onboarding-wifi-dialog")
  private _onboardingDialog?: HTMLElement & { open(): void };

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

  private _portToastMs = new Map<SerialPort, number>();
  private static readonly PORT_TOAST_DEDUP_MS = 60_000;

  private _onSerialConnect = (event: Event) => {
    // Suppress connect events that fire as a side-effect of our own
    // serial ops. esptool-js's chip reset toggles DTR/RTS, which on
    // native-USB chips (ESP32-C6 / S3 / C3) drops the USB device and
    // re-enumerates it — firing a fresh connect event for the same
    // port. Without this guard the toast loops every time the user
    // clicks "Set it up" (each click triggers another reset).
    const recent = isRecentSerialActivity();
    if (recent) {
      // Self-extend the window: a burst of re-enum events from the
      // same chip reset keeps the suppression alive even if the
      // events trickle in slower than the static window. Without
      // this a slow re-enum could land outside the original window
      // and leak a toast through despite the op being ongoing.
      markSerialActivity();
      return;
    }

    // Per-port dedup. A bare-flash board with no app to feed the
    // RTC watchdog can reboot-loop, which on native-USB chips
    // re-enumerates the device on every restart — firing a fresh
    // connect event each cycle. Don't re-toast for the same port
    // within a generous window; the user already saw it the first
    // time. SerialPort identity is stable across re-enums per the
    // Web Serial spec, so reference equality is the right key.
    //
    // Modern Chromium follows the current WICG spec: the event is
    // fired at ``navigator.serial`` with the SerialPort as
    // ``event.target``. An older draft of the spec exposed the port
    // on a ``SerialConnectionEvent.port`` property instead, so check
    // both — covers legacy / non-Chromium implementations without
    // changing the modern path.
    const eventPort = (event as { port?: unknown }).port;
    const port =
      eventPort instanceof SerialPort
        ? eventPort
        : event.target instanceof SerialPort
          ? event.target
          : null;
    if (port) {
      const now = Date.now();
      // Lazy eviction of stale entries so the map can't grow
      // unbounded over a long session that sees many distinct
      // ports. ``navigator.serial`` holds permitted SerialPort
      // references for the lifetime of the page, so a WeakMap
      // wouldn't free them either — explicit time-based eviction
      // is the right tool.
      for (const [p, ts] of this._portToastMs) {
        if (now - ts >= ESPHomeApp.PORT_TOAST_DEDUP_MS) {
          this._portToastMs.delete(p);
        }
      }
      const last = this._portToastMs.get(port);
      if (last !== undefined && now - last < ESPHomeApp.PORT_TOAST_DEDUP_MS) {
        return;
      }
      this._portToastMs.set(port, now);
    }
    toast.info(this._localize("layout.usb_device_connected"), {
      // Stable id so multiple connect events collapse onto the same
      // toast instead of stacking — defence in depth on top of the
      // time-window suppression above.
      id: "esphome-usb-device-connected",
      richColors: true,
      duration: 8000,
      action: {
        label: this._localize("layout.usb_device_setup"),
        onClick: () => {
          // Bridge the gap between the click and the first internal
          // markSerialActivity inside connectToPort — the chip
          // reset can fire a new connect event before that runs.
          markSerialActivity();
          toast.dismiss("esphome-usb-device-connected");
          window.dispatchEvent(
            new CustomEvent("esphome-serial-setup", { detail: { port } }),
          );
        },
      },
    });
  };

  private _onSecretsSaved = () => {
    void loadOnboardingState(this);
  };

  connectedCallback() {
    super.connectedCallback();
    void this._init();
    if ("serial" in navigator) {
      navigator.serial.addEventListener("connect", this._onSerialConnect);
    }
    window.addEventListener("secrets-saved", this._onSecretsSaved);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._api.disconnect();
    clearRecentJobs(this);
    if ("serial" in navigator) {
      navigator.serial.removeEventListener("connect", this._onSerialConnect);
    }
    window.removeEventListener("secrets-saved", this._onSecretsSaved);
  }

  applyTheme(theme: Theme) {
    localStorage.setItem("esphome-theme", theme);
    const prefersDark =
      theme === Theme.SYSTEM
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : theme === Theme.DARK;
    this._darkMode = prefersDark;
    document.documentElement.classList.toggle("wa-dark", prefersDark);
    document.documentElement.classList.toggle("wa-light", !prefersDark);
  }

  private _initDarkMode() {
    const saved = (localStorage.getItem("esphome-theme") as Theme) ?? Theme.SYSTEM;
    this.applyTheme(saved);
  }

  private async _init() {
    toast.config({
      toastOptions: {
        // bottom-left keeps toasts clear of the editor's bottom-right
        // Install/Validate/Save FAB cluster (#921, prior fix #171).
        position: "bottom-left",
        richColors: true,
        duration: 4000,
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

    // ServerInfo is safe pre-auth (it's the auth-gate input itself); anything
    // that sends commands must wait for api.ready.
    this._api.onConnected = (info: ServerInfoMessage) => {
      this._version = info.esphome_version;
      this._serverVersion = info.server_version;
      this._isHaIngress = info.ha_addon && BASE_PATH.includes("/ingress");
      this._apiConnected = true;
      void this._api.ready.then(() => this._afterAuthenticated());
    };
    this._api.onAuthRequired = () => {
      this._authState = "needs-login";
      this._authError = null;
      this._rateLimitedUntil = 0;
    };
    this._api.onDisconnected = () => {
      console.warn("WebSocket disconnected, will auto-reconnect...");
      this._apiConnected = false;
    };

    try {
      await this._api.connect();
    } catch (err) {
      console.error("Failed to connect to WebSocket:", err);
    }
  }

  // Idempotent across reconnects.
  private async _afterAuthenticated() {
    this._authState = "authed";
    this._authError = null;
    this._subscribeToEvents();
    subscribeToFollowJobs(this);
    void loadIntegrationDocs(this);
    void loadLabels(this);
    void loadThemePreference(this);
    void loadRemoteBuildSettings(this);
    void loadOnboardingState(this);
  }

  private async _subscribeToEvents() {
    try {
      await this._api.subscribeEvents((event, data) => handleEvent(this, event, data));
    } catch (err) {
      console.error("Failed to subscribe to events:", err);
    }
  }

  // Triggered by the onboarding dialog after a save or explicit decline.
  // Refresh state so the badge reflects new data.
  _onOnboardingAcknowledged = () => {
    this._onboardingShouldShow = false;
    void loadOnboardingState(this);
  };

  _onOnboardingDismissedSession = () => {
    this._onboardingSessionDismissed = true;
    this._onboardingShouldShow = false;
  };

  // Kebab "Set up Wi-Fi" — explicit user intent, overrides both gates.
  private _onOpenOnboarding = () => {
    this._onboardingSessionDismissed = false;
    this._onboardingDialog?.open();
  };

  // Stamp display fields (configuration / target / receiver_label) on the
  // in-flight remote-build job map after submit ack returns. Wire events
  // don't carry these, so without this the progress dialog renders empty.
  // Preserves any output / status a racing event already stamped.
  registerRemoteBuildJob(seed: {
    job_id: string;
    pin_sha256: string;
    receiver_label: string;
    configuration: string;
    target: RemoteBuildSubmitTarget;
  }): void {
    const next = new Map(this._buildOffloadJobs);
    const existing = next.get(seed.job_id);
    next.set(seed.job_id, {
      job_id: seed.job_id,
      pin_sha256: seed.pin_sha256,
      receiver_label: seed.receiver_label,
      configuration: seed.configuration,
      target: seed.target,
      status: existing?.status ?? JobStatus.QUEUED,
      error_message: existing?.error_message ?? "",
      output: existing?.output ?? [],
      // || not ?? — stubRemoteBuildJobState seeds 0 as the "unset" sentinel;
      // any existing>0 wins (entry stamped on a previous submit), 0 from a
      // stub gets replaced so sorters reliably pick the newest.
      started_at: existing?.started_at || Date.now(),
    });
    this._buildOffloadJobs = next;
  }

  dismissRemoteBuildJob(job_id: string): void {
    if (!this._buildOffloadJobs.has(job_id)) return;
    const next = new Map(this._buildOffloadJobs);
    next.delete(job_id);
    this._buildOffloadJobs = next;
  }

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
          @submit-credentials=${(e: CustomEvent<{ username: string; password: string }>) =>
            onLoginSubmit(this, e)}
        ></esphome-login>
      `;
    }

    return html`
      <esphome-layout
        @set-theme=${(e: CustomEvent<string>) => onSetTheme(this, e)}
        @set-yaml-diff-button=${(e: CustomEvent<boolean>) => onSetYamlDiffButton(this, e)}
        @set-language=${(e: CustomEvent<Parameters<typeof onSetLanguage>[1]["detail"]>) =>
          onSetLanguage(this, e as Parameters<typeof onSetLanguage>[1])}
        @open-settings=${() => this._settingsDialog?.open()}
        @open-firmware-jobs=${() => this._firmwareJobsDialog?.open()}
        @open-reset-build-env=${() => this._firmwareJobsDialog?.openResetBuildEnv()}
        @open-feedback=${() => this._feedbackDialog?.open()}
        @open-onboarding-wifi=${this._onOpenOnboarding}
      >
        ${this._router.outlet()}
      </esphome-layout>
      <esphome-command-palette
        @set-theme=${(e: CustomEvent<string>) => onSetTheme(this, e)}
        @set-yaml-diff-button=${(e: CustomEvent<boolean>) => onSetYamlDiffButton(this, e)}
        @set-language=${(e: CustomEvent<Parameters<typeof onSetLanguage>[1]["detail"]>) =>
          onSetLanguage(this, e as Parameters<typeof onSetLanguage>[1])}
      ></esphome-command-palette>
      <esphome-settings-dialog
        @set-theme=${(e: CustomEvent<string>) => onSetTheme(this, e)}
        @set-yaml-diff-button=${(e: CustomEvent<boolean>) => onSetYamlDiffButton(this, e)}
        @set-remote-build-enabled=${(e: CustomEvent<boolean>) =>
          onSetRemoteBuildEnabled(this, e)}
        @set-remote-build-cleanup-ttl=${(e: CustomEvent<number>) =>
          onSetRemoteBuildCleanupTtl(this, e)}
        @set-offloader-remote-builds-enabled=${(e: CustomEvent<boolean>) =>
          onSetOffloaderRemoteBuildsEnabled(this, e)}
        @set-offloader-pairing-enabled=${(
          e: CustomEvent<{ pin_sha256: string; enabled: boolean }>,
        ) => onSetOffloaderPairingEnabled(this, e)}
        @set-language=${(e: CustomEvent<Parameters<typeof onSetLanguage>[1]["detail"]>) =>
          onSetLanguage(this, e as Parameters<typeof onSetLanguage>[1])}
        @pair-request-sent=${(e: CustomEvent<{ summary: PairingSummary }>) =>
          onPairRequestSent(this, e)}
        @remote-build-job-submitted=${(
          e: CustomEvent<Parameters<typeof onRemoteBuildJobSubmitted>[1]["detail"]>,
        ) =>
          onRemoteBuildJobSubmitted(
            this,
            e as Parameters<typeof onRemoteBuildJobSubmitted>[1],
          )}
        @remote-build-job-dismissed=${(e: CustomEvent<{ job_id: string }>) =>
          onRemoteBuildJobDismissed(this, e)}
      ></esphome-settings-dialog>
      <esphome-firmware-jobs-dialog
        @firmware-history-cleared=${() => onFirmwareHistoryCleared(this)}
      ></esphome-firmware-jobs-dialog>
      <esphome-feedback-dialog></esphome-feedback-dialog>
      <esphome-onboarding-wifi-dialog
        @onboarding-acknowledged=${this._onOnboardingAcknowledged}
        @onboarding-dismissed-session=${this._onOnboardingDismissedSession}
      ></esphome-onboarding-wifi-dialog>
    `;
  }

  // When _onboardingShouldShow flips true, programmatically open the dialog.
  // The dialog is mounted unconditionally (so listeners are wired) but starts closed.
  protected updated(changed: PropertyValues) {
    super.updated?.(changed);
    if (changed.has("_onboardingShouldShow") && this._onboardingShouldShow) {
      this._onboardingDialog?.open();
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-app": ESPHomeApp;
  }
}
