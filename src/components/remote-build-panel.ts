import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import { consume } from "@lit/context";
import {
  mdiChevronDown,
  mdiHandshake,
  mdiMonitorDashboard,
  mdiServerNetwork,
} from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import memoizeOne from "memoize-one";
import type { ESPHomeAPI } from "../api/index.js";
import type { ConfiguredDevice } from "../api/types/devices.js";
import type { FirmwareJob } from "../api/types/firmware-jobs.js";
import type {
  PairingSummary,
  PairingWindowState,
  PeerSummary,
} from "../api/types/remote-build.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  buildServerIdentityRotationCounterContext,
  buildServerPairingWindowStateContext,
  buildOffloadPairingsContext,
  buildServerPeersContext,
  devicesContext,
  firmwareJobsContext,
  localizeContext,
  remoteBuildEnabledContext,
} from "../context/index.js";
import { pairingAddressStyles } from "../styles/pairing-address.js";
import { pairingWindowStyles } from "../styles/pairing-window.js";
import { pinHexStyles } from "../styles/pin-hex.js";
import { espHomeStyles } from "../styles/shared.js";
import { textStyles } from "../styles/text.js";
import { cancelFirmwareJob } from "../util/firmware-job-actions.js";
import { firmwareJobDisplayName } from "../util/firmware-job-display.js";
import { notify } from "../util/notify.js";
import { NowTickController } from "../util/now-tick-controller.js";
import { PairingWindowController } from "../util/pairing-window-controller.js";
import { approvePeerRequest, rejectPeerRequest } from "../util/peer-pairing-actions.js";
import { postInstallShowLogsHandler } from "../util/post-install-logs.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { RemoteBuildIdentityController } from "../util/remote-build-identity-controller.js";
import "./accept-peer-dialog.js";
import type { ESPHomeAcceptPeerDialog } from "./accept-peer-dialog.js";
import "./command-dialog.js";
import type { ESPHomeCommandDialog } from "./command-dialog.js";
import "./logs-dialog.js";
import type { ESPHomeLogsDialog } from "./logs-dialog.js";
import "./pin-emoji-grid.js";
import {
  renderDisabledCta,
  renderOnboarding,
} from "./remote-build-panel/render-onboarding.js";
import { renderPeersCard, renderRequestCard } from "./remote-build-panel/render-peers.js";
import { renderQueueCard } from "./remote-build-panel/render-queue.js";
import { remoteBuildPanelStyles } from "./remote-build-panel/styles.js";
import { bucketJobs } from "./shared/firmware-jobs-list.js";
import { firmwareJobsListStyles } from "./shared/firmware-jobs-list-styles.js";
import { stackBarStyles } from "./shared/stack-bar-styles.js";
import { peerRowStyles } from "../styles/peer-rows.js";

registerMdiIcons({
  "chevron-down": mdiChevronDown,
  handshake: mdiHandshake,
  "monitor-dashboard": mdiMonitorDashboard,
  "server-network": mdiServerNetwork,
});

/**
 * Landing surface for a remote-compute-only install (the dashboard page
 * embeds it above / instead of the device grid).
 *
 * Makes the receiver workflow discoverable without digging through Settings:
 * pairing walkthrough while nothing is paired, incoming pair requests pinned
 * on top, paired dashboards with live connected state, and the local build
 * queue the paired senders feed.
 */
@customElement("esphome-remote-build-panel")
export class ESPHomeRemoteBuildPanel extends LitElement {
  /** Collapsed = banner only (with waiting/building badges); the embedding
   *  page owns the flag and flips it on `toggle-collapsed`. Reflected so
   *  the page can join the collapsed bar with the builder header below. */
  @property({ type: Boolean, reflect: true }) collapsed = false;

  /** The Device builder section is hidden (hide_device_builder pref):
   *  this panel is the whole dashboard, so the accordion banner isn't
   *  rendered at all. */
  @property({ type: Boolean, reflect: true }) solo = false;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext }) _api!: ESPHomeAPI;

  @consume({ context: buildServerPeersContext, subscribe: true })
  @state()
  _peers: PeerSummary[] | null = null;

  @consume({ context: buildOffloadPairingsContext, subscribe: true })
  @state()
  _pairings: Map<string, PairingSummary> | null = null;

  // FirmwareJobsListHost's receiver-side registry — same value as _peers,
  // named for the shared list renderer.
  get _buildServerPeers(): PeerSummary[] | null {
    return this._peers;
  }

  @consume({ context: buildServerPairingWindowStateContext, subscribe: true })
  @state()
  _windowState: PairingWindowState | null = null;

  @consume({ context: remoteBuildEnabledContext, subscribe: true })
  @state()
  _remoteBuildEnabled = false;

  @consume({ context: buildServerIdentityRotationCounterContext, subscribe: true })
  @state()
  _rotationCounter = 0;

  @consume({ context: firmwareJobsContext, subscribe: true })
  @state()
  _jobs: Map<string, FirmwareJob> = new Map();

  @consume({ context: devicesContext, subscribe: true })
  @state()
  _devices: ConfiguredDevice[] = [];

  // Explicit-open only: a permanently mounted panel must not hold the
  // pairing window open the way the settings inbox (autoOpen) does.
  readonly _window = new PairingWindowController(this, {
    getApi: () => this._api,
    onOpenFailed: () =>
      notify.warning(this._localize("settings.build_server_pairing_window_open_failed")),
    onExtendFailed: () =>
      notify.warning(
        this._localize("settings.build_server_pairing_window_extend_failed")
      ),
  });

  readonly _identity = new RemoteBuildIdentityController(this, () => this._api);

  private readonly _ticker = new NowTickController(this);

  private _bucketJobs = memoizeOne(bucketJobs);

  @query("esphome-accept-peer-dialog")
  private _acceptPeerDialog!: ESPHomeAcceptPeerDialog;
  @query("esphome-command-dialog") private _commandDialog!: ESPHomeCommandDialog;
  @query("esphome-logs-dialog") private _logsDialog!: ESPHomeLogsDialog;

  private _onPostInstallShowLogs = postInstallShowLogsHandler(
    () => this._logsDialog,
    () => this._localize
  );

  static styles = [
    espHomeStyles,
    pinHexStyles,
    pairingAddressStyles,
    pairingWindowStyles,
    peerRowStyles,
    textStyles,
    firmwareJobsListStyles,
    stackBarStyles,
    remoteBuildPanelStyles,
  ];

  get _now(): number {
    return this._ticker.now;
  }

  protected updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (changed.has("_windowState")) {
      this._window.onStateChanged(this._windowState);
    }
    // Neither ticker has visible output while collapsed (the countdown
    // chip and relative timestamps only render expanded), so both
    // suspend rather than re-rendering a static banner every second.
    if (changed.has("collapsed")) {
      this._window.setTickSuspended(this.collapsed);
    }
    if (this.collapsed) this._ticker.stop();
    else this._ticker.start();
    if (
      changed.has("_rotationCounter") &&
      changed.get("_rotationCounter") !== undefined
    ) {
      this._identity.onRotationCounterChanged();
    }
  }

  protected render() {
    const pending = this._peers?.filter((p) => p.status === "pending") ?? [];
    return html`
      <section class="panel" aria-label=${this._localize("remote_build_dashboard.title")}>
        ${this.solo ? nothing : this._renderBanner(pending.length)}
        ${
          this.collapsed
            ? nothing
            : html`${pending.map((p) => renderRequestCard(this, p))} ${this._renderBody()}`
        }
      </section>
      <esphome-accept-peer-dialog
        @confirm=${this._onAcceptConfirm}
        @reject=${this._onRejectFromDialog}
      ></esphome-accept-peer-dialog>
      <esphome-command-dialog
        @request-show-logs-after-install=${this._onPostInstallShowLogs}
      ></esphome-command-dialog>
      <esphome-logs-dialog></esphome-logs-dialog>
    `;
  }

  _openWindow = () => {
    this._window.open();
  };

  _extendWindow = () => {
    this._window.extend();
  };

  _reviewRequest(peer: PeerSummary) {
    this._acceptPeerDialog.open(peer);
  }

  _openBuildServerSettings = () => {
    this.dispatchEvent(
      new CustomEvent("open-settings", {
        detail: { section: "build_server" },
        bubbles: true,
        composed: true,
      })
    );
  };

  _jobDisplayName(job: FirmwareJob): string {
    return firmwareJobDisplayName(job, this._devices, this._localize);
  }

  _openJob(job: FirmwareJob) {
    this._commandDialog.followJob(job, this._jobDisplayName(job));
  }

  _onCancelClick(e: Event, job: FirmwareJob) {
    e.stopPropagation();
    void this._cancel(job);
  }

  _buckets() {
    return this._bucketJobs(this._jobs);
  }

  private _renderBanner(pendingCount: number) {
    const activeCount = this._buckets().active.length;
    return html`
      <button
        type="button"
        class="banner stack-bar"
        aria-expanded=${this.collapsed ? "false" : "true"}
        @click=${this._onToggleCollapsed}
      >
        <wa-icon library="mdi" name="server-network"></wa-icon>
        <span class="stack-bar-main">
          <span class="stack-bar-title">
            ${this._localize("remote_build_dashboard.title")}
          </span>
          <span class="stack-bar-subtitle">
            ${this._localize("remote_build_dashboard.tagline")}
          </span>
          ${
            this.collapsed && pendingCount > 0
              ? html`
                  <span class="banner-badge banner-badge--requests">
                    ${this._localize("remote_build_dashboard.badge_requests", {
                      count: pendingCount,
                    })}
                  </span>
                `
              : nothing
          }
          ${
            this.collapsed && activeCount > 0
              ? html`
                  <span class="banner-badge">
                    ${this._localize("remote_build_dashboard.badge_active", {
                      count: activeCount,
                    })}
                  </span>
                `
              : nothing
          }
        </span>
        <wa-icon
          class="stack-bar-chevron"
          library="mdi"
          name="chevron-down"
          aria-hidden="true"
        ></wa-icon>
      </button>
    `;
  }

  private _onToggleCollapsed = () => {
    this.dispatchEvent(
      new CustomEvent("toggle-collapsed", { bubbles: true, composed: true })
    );
  };

  private _renderBody() {
    if (!this._remoteBuildEnabled) return renderDisabledCta(this);
    if (this._peers === null) {
      return html`
        <div class="status-row" role="status">
          ${this._localize("settings.build_server_pairing_requests_loading")}
        </div>
      `;
    }
    const approved = this._peers.filter((p) => p.status === "approved");
    if (approved.length === 0) {
      return html`<div class="onboarding">${renderOnboarding(this)}</div>`;
    }
    return html`
      <div class="cards">${renderPeersCard(this, approved)} ${renderQueueCard(this)}</div>
    `;
  }

  private async _onAcceptConfirm(e: CustomEvent<{ dashboardId: string }>) {
    await approvePeerRequest(this._api, this._localize, e.detail.dashboardId);
  }

  private async _onRejectFromDialog(e: CustomEvent<{ dashboardId: string }>) {
    await rejectPeerRequest(this._api, this._localize, e.detail.dashboardId);
  }

  private async _cancel(job: FirmwareJob) {
    await cancelFirmwareJob(this._api, this._localize, job.job_id);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-remote-build-panel": ESPHomeRemoteBuildPanel;
  }
}
