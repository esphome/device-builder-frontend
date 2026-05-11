import { consume } from "@lit/context";
import { mdiPencil } from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import toast from "sonner-js";

import type { ESPHomeAPI } from "../../api/esphome-api.js";
import type {
  OffloaderAlertSnapshotEntry,
  PairingSummary,
  RemoteBuildPeer,
} from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  apiContext,
  buildOffloadAlertsContext,
  buildOffloadDiscoveredHostsContext,
  buildOffloadJobsContext,
  buildOffloadPairingsContext,
  localizeContext,
  offloaderRemoteBuildsEnabledContext,
  versionContext,
} from "../../context/index.js";
import type { RemoteBuildJobState } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import {
  normalizeHostnameForCompare,
  trimTrailingDot,
} from "../../util/hostname.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";
import type { ESPHomeEditPairingEndpointDialog } from "../edit-pairing-endpoint-dialog.js";
import type { ESPHomePairBuildServerDialog } from "../pair-build-server-dialog.js";
import type { ESPHomeReauthWizardDialog } from "../reauth-wizard-dialog.js";
import type { ESPHomeRemoteBuildJobDialog } from "../remote-build-job-dialog.js";
import { renderOffloaderAlert } from "./build-offload-alert.js";
import {
  latestJobForPin,
  renderPairingRow,
} from "./build-offload-pairing-row.js";
import { offloaderAlertStyles, pairingRowStyles } from "./offload-styles.js";
import {
  peerRowStyles,
  settingsRowStyles,
  settingsSharedStyles,
} from "./shared-styles.js";

import "../confirm-dialog.js";
import "../edit-pairing-endpoint-dialog.js";
import "../pair-build-server-dialog.js";
import "../reauth-wizard-dialog.js";
import "../remote-build-job-dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ pencil: mdiPencil });

@customElement("esphome-settings-build-offload")
export class ESPHomeSettingsBuildOffload extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api?: ESPHomeAPI;

  @consume({ context: versionContext, subscribe: true })
  @state()
  private _appVersion = "";

  @consume({ context: buildOffloadDiscoveredHostsContext, subscribe: true })
  @state()
  private _discoveredHosts: Map<string, RemoteBuildPeer> | null = null;

  @consume({ context: buildOffloadPairingsContext, subscribe: true })
  @state()
  private _pairings: Map<string, PairingSummary> | null = null;

  @consume({ context: offloaderRemoteBuildsEnabledContext, subscribe: true })
  @state()
  private _remoteBuildsEnabled: boolean | null = null;

  @consume({ context: buildOffloadAlertsContext, subscribe: true })
  @state()
  private _alerts: Map<string, OffloaderAlertSnapshotEntry> | null = null;

  @consume({ context: buildOffloadJobsContext, subscribe: true })
  @state()
  private _jobs: Map<string, RemoteBuildJobState> | null = null;

  @state()
  private _pendingUnpair: {
    pin_sha256: string;
    hostname: string;
    port: number;
    label: string;
  } | null = null;

  @query("esphome-pair-build-server-dialog")
  private _pairDialog!: ESPHomePairBuildServerDialog;

  @query("esphome-reauth-wizard-dialog")
  private _reauthDialog!: ESPHomeReauthWizardDialog;

  @query("esphome-edit-pairing-endpoint-dialog")
  private _editEndpointDialog!: ESPHomeEditPairingEndpointDialog;

  @query("esphome-remote-build-job-dialog")
  private _jobDialog!: ESPHomeRemoteBuildJobDialog;

  @query("#unpair-confirm")
  private _unpairConfirmDialog!: ESPHomeConfirmDialog;

  static styles = [
    espHomeStyles,
    settingsSharedStyles,
    settingsRowStyles,
    peerRowStyles,
    offloaderAlertStyles,
    pairingRowStyles,
  ];

  protected render() {
    return html`
      ${this._renderAlerts()}
      ${this._renderRemoteBuildsToggle()}

      <div class="section-heading">
        ${this._localize("settings.paired_build_servers_heading")}
      </div>
      <div class="section-intro">
        ${this._localize("settings.paired_build_servers_desc")}
      </div>
      ${this._renderPairings()}

      <div class="section-heading">
        ${this._localize("settings.remote_build_known_dashboards")}
      </div>
      ${this._renderDiscoveredHosts()}

      <div class="section-heading">
        ${this._localize("settings.pair_build_server_section_heading")}
      </div>
      <div class="section-intro">
        ${this._localize("settings.pair_build_server_section_desc")}
      </div>
      <div class="row pair-build-server-row">
        <div class="row-label">
          <span class="row-desc">
            ${this._localize("settings.pair_build_server_row_helper")}
          </span>
        </div>
        <button
          class="btn-pair-build-server"
          type="button"
          @click=${this._onPairClick}
        >
          ${this._localize("settings.pair_build_server_open_action")}
        </button>
      </div>

      <esphome-pair-build-server-dialog
        @pair-request-sent=${this._onPairRequestSent}
        @pair-approved=${this._onPairApproved}
        @pair-rejected=${this._onPairRejected}
      ></esphome-pair-build-server-dialog>
      <esphome-reauth-wizard-dialog
        @reauth-confirmed=${this._onReauthConfirmed}
      ></esphome-reauth-wizard-dialog>
      <esphome-remote-build-job-dialog></esphome-remote-build-job-dialog>
      <esphome-edit-pairing-endpoint-dialog></esphome-edit-pairing-endpoint-dialog>
      <esphome-confirm-dialog
        id="unpair-confirm"
        destructive
        heading=${this._localize("settings.unpair_confirm_title")}
        message=${this._unpairMessage()}
        confirm-label=${this._localize("settings.unpair_confirm_confirm")}
        @confirm=${this._onUnpairConfirm}
      ></esphome-confirm-dialog>
    `;
  }

  private _renderRemoteBuildsToggle() {
    if (this._remoteBuildsEnabled === null) {
      return html`
        <div class="row" role="status">
          <div class="row-label">
            <span class="row-title">
              ${this._localize("settings.offloader_remote_builds_enabled")}
            </span>
            <span class="row-desc">
              ${this._localize(
                "settings.offloader_remote_builds_enabled_loading",
              )}
            </span>
          </div>
        </div>
      `;
    }
    return html`
      <div class="row">
        <div class="row-label">
          <span id="offloader-remote-builds-enabled-title" class="row-title">
            ${this._localize("settings.offloader_remote_builds_enabled")}
          </span>
          <span class="row-desc">
            ${this._localize("settings.offloader_remote_builds_enabled_desc")}
          </span>
        </div>
        <button
          class="toggle"
          role="switch"
          aria-labelledby="offloader-remote-builds-enabled-title"
          aria-checked=${this._remoteBuildsEnabled}
          @click=${this._onToggleRemoteBuilds}
        ></button>
      </div>
    `;
  }

  private _renderAlerts() {
    if (this._alerts === null || this._alerts.size === 0) return nothing;
    return Array.from(this._alerts.values()).map((alert) =>
      renderOffloaderAlert(alert, {
        localize: this._localize,
        onRepair: this._onAlertRepair,
        onUnpair: this._onAlertUnpair,
      }),
    );
  }

  private _renderPairings() {
    if (this._pairings === null) {
      return this._statusRow("settings.paired_build_servers_loading");
    }
    if (this._pairings.size === 0) {
      return this._statusRow("settings.paired_build_servers_empty");
    }
    return Array.from(this._pairings.values()).map((p) =>
      renderPairingRow(p, {
        localize: this._localize,
        appVersion: this._appVersion,
        latestJob: latestJobForPin(this._jobs, p.pin_sha256),
        onToggleEnabled: this._onTogglePairingEnabled,
        onBuildRemote: this._onBuildRemoteClick,
        onViewBuild: (jobId) => this._jobDialog?.openForJob(jobId),
        onEditEndpoint: this._onEditEndpointClick,
        onUnpair: this._onUnpairRequest,
      }),
    );
  }

  private _statusRow(key: string) {
    return html`
      <div class="row" role="status">
        <div class="row-label">
          <span class="row-desc">${this._localize(key)}</span>
        </div>
      </div>
    `;
  }

  private _renderDiscoveredHosts() {
    if (this._discoveredHosts === null) {
      return this._statusRow("settings.remote_build_peers_loading");
    }
    const peers = Array.from(this._discoveredHosts.values()).filter(
      (peer) => !this._hasPairingFor(peer.hostname),
    );
    if (peers.length === 0) {
      return this._statusRow("settings.remote_build_peers_empty");
    }
    return peers.map((peer) => this._renderDiscoveredRow(peer));
  }

  private _renderDiscoveredRow(peer: RemoteBuildPeer) {
    const versionLine = peer.esphome_version
      ? this._localize("settings.remote_build_peer_version_line", {
          esphome: peer.esphome_version,
        })
      : nothing;
    return html`
      <div class="row peer-row">
        <div class="row-label">
          <span class="row-title">${trimTrailingDot(peer.name)}</span>
          <span class="row-desc">
            ${trimTrailingDot(peer.hostname)}:${peer.port} ${versionLine}
          </span>
        </div>
        <button
          type="button"
          class="btn-pair-build-server btn-pair-row"
          aria-label=${this._localize("settings.pair_build_server_row_aria", {
            name: trimTrailingDot(peer.name),
          })}
          @click=${() => this._onPairDiscovered(peer)}
        >
          ${this._localize("settings.pair_build_server_row_action")}
        </button>
      </div>
    `;
  }

  private _hasPairingFor(hostname: string): boolean {
    const pairings = this._pairings;
    if (pairings === null || pairings.size === 0) return false;
    const target = normalizeHostnameForCompare(hostname);
    for (const pairing of pairings.values()) {
      if (normalizeHostnameForCompare(pairing.receiver_hostname) === target) {
        return true;
      }
    }
    return false;
  }

  private _unpairMessage(): string {
    if (this._pendingUnpair === null) {
      return this._localize("settings.unpair_confirm_body");
    }
    return this._localize("settings.unpair_confirm_body_named", {
      label: this._pendingUnpair.label,
      hostname: trimTrailingDot(this._pendingUnpair.hostname),
      port: String(this._pendingUnpair.port),
    });
  }

  private _onToggleRemoteBuilds = () => {
    if (this._remoteBuildsEnabled === null) return;
    this.dispatchEvent(
      new CustomEvent("set-offloader-remote-builds-enabled", {
        detail: !this._remoteBuildsEnabled,
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onTogglePairingEnabled = (pairing: PairingSummary) => {
    this.dispatchEvent(
      new CustomEvent("set-offloader-pairing-enabled", {
        detail: { pin_sha256: pairing.pin_sha256, enabled: !pairing.enabled },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onPairClick = (): void => {
    this._pairDialog?.open();
  };

  private _onPairDiscovered = (peer: RemoteBuildPeer): void => {
    // remote_build_port is the peer-link Noise WS port (TXT key);
    // peer.port is the SRV dashboard HTTP port and would land an
    // UNAVAILABLE on preview_pair. 0 means the receiver didn't
    // publish the key — let the wizard fall back to its default.
    this._pairDialog?.open({
      hostname: peer.hostname,
      port: peer.remote_build_port > 0 ? peer.remote_build_port : undefined,
    });
  };

  private _onAlertRepair = (alert: OffloaderAlertSnapshotEntry): void => {
    // pin_mismatch routes through re-auth so the operator sees
    // expected-vs-observed fingerprints before re-pair fires.
    if (alert.kind === "pin_mismatch") {
      this._reauthDialog?.open(alert);
      return;
    }
    this._pairDialog?.open({
      hostname: alert.receiver_hostname,
      port: alert.receiver_port,
    });
  };

  private _onReauthConfirmed = (
    e: CustomEvent<{ hostname: string; port: number }>,
  ): void => {
    this._pairDialog?.open({
      hostname: e.detail.hostname,
      port: e.detail.port,
    });
  };

  private _onAlertUnpair = (alert: OffloaderAlertSnapshotEntry): void => {
    this._pendingUnpair = {
      pin_sha256: alert.pin_sha256,
      hostname: alert.receiver_hostname,
      port: alert.receiver_port,
      label: alert.receiver_label,
    };
    this._unpairConfirmDialog?.open();
  };

  private _onUnpairRequest = (pairing: PairingSummary): void => {
    this._pendingUnpair = {
      pin_sha256: pairing.pin_sha256,
      hostname: pairing.receiver_hostname,
      port: pairing.receiver_port,
      label: pairing.label,
    };
    this._unpairConfirmDialog?.open();
  };

  private _onUnpairConfirm = async (): Promise<void> => {
    const pending = this._pendingUnpair;
    this._pendingUnpair = null;
    if (this._api === undefined || pending === null) return;
    try {
      await this._api.unpairRemoteBuild({ pin_sha256: pending.pin_sha256 });
    } catch (err) {
      console.warn("unpair failed:", err);
      this._toast("error", "settings.unpair_failed", { label: pending.label });
      return;
    }
    this._toast("success", "settings.unpair_success", { label: pending.label });
  };

  private _onBuildRemoteClick = (pairing: PairingSummary): void => {
    this._jobDialog?.open({
      pin_sha256: pairing.pin_sha256,
      receiver_label: pairing.label,
    });
  };

  private _onEditEndpointClick = (pairing: PairingSummary): void => {
    this._editEndpointDialog?.open(pairing);
  };

  private _onPairApproved = (
    e: CustomEvent<{ hostname: string; port: number }>,
  ): void => {
    this._toast("success", "settings.pair_build_server_approved_toast", {
      hostname: e.detail.hostname,
      port: String(e.detail.port),
    });
  };

  private _onPairRejected = (
    e: CustomEvent<{ hostname: string; port: number }>,
  ): void => {
    this._toast("warning", "settings.pair_build_server_rejected_toast", {
      hostname: e.detail.hostname,
      port: String(e.detail.port),
    });
  };

  private _onPairRequestSent = (
    e: CustomEvent<{ summary: PairingSummary }>,
  ): void => {
    // Bubbles past us to app-shell, which seeds the new pending
    // row into the pairings map. We just surface the toast.
    this._toast("success", "settings.pair_build_server_sent_toast", {
      hostname: e.detail.summary.receiver_hostname,
      port: String(e.detail.summary.receiver_port),
    });
  };

  private _toast(
    level: "success" | "warning" | "error",
    key: string,
    values?: Record<string, string | number>,
  ) {
    toast[level](this._localize(key, values), { richColors: true });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-build-offload": ESPHomeSettingsBuildOffload;
  }
}
