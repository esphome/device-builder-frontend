import { consume } from "@lit/context";
import { LitElement, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import toast from "sonner-js";

import { APIError } from "../../api/api-error.js";
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import { ErrorCode, type PairingWindowState, type PeerSummary } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  apiContext,
  buildServerPairingWindowStateContext,
  buildServerPeersContext,
  localizeContext,
} from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { remainingOf } from "../../util/relative-time.js";
import type { ESPHomeAcceptPeerDialog } from "../accept-peer-dialog.js";
import { pairingWindowStyles } from "./pairing-styles.js";
import {
  peerRowStyles,
  settingsRowStyles,
  settingsSharedStyles,
} from "./shared-styles.js";

import "../accept-peer-dialog.js";

@customElement("esphome-settings-pairing-requests")
export class ESPHomeSettingsPairingRequests extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api?: ESPHomeAPI;

  @consume({ context: buildServerPeersContext, subscribe: true })
  @state()
  private _peers: PeerSummary[] | null = null;

  @consume({ context: buildServerPairingWindowStateContext, subscribe: true })
  @state()
  private _windowState: PairingWindowState | null = null;

  @state()
  private _baselineSeconds: number | null = null;

  private _anchorMs = 0;

  @state()
  private _tick = 0;

  private _tickHandle: ReturnType<typeof setInterval> | null = null;

  @query("esphome-accept-peer-dialog")
  private _acceptPeerDialog!: ESPHomeAcceptPeerDialog;

  static styles = [
    espHomeStyles,
    settingsSharedStyles,
    settingsRowStyles,
    peerRowStyles,
    pairingWindowStyles,
  ];

  connectedCallback() {
    super.connectedCallback();
    // Open the receiver-side pairing window so intent="pair_request"
    // Noise frames are accepted while the operator is on this screen.
    // Refcounted server-side; closes on disconnect or 5min idle.
    if (this._api !== undefined) {
      void this._api.setRemoteBuildPairingWindow({ open: true }).catch(() => {
        this._toast("warning", "settings.build_server_pairing_window_open_failed");
      });
    }
  }

  disconnectedCallback() {
    this._stopTick();
    if (this._api !== undefined) {
      void this._api.setRemoteBuildPairingWindow({ open: false }).catch(() => {
        // Idle timer is the safety net.
      });
    }
    super.disconnectedCallback();
  }

  protected updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (changed.has("_windowState")) {
      const state = this._windowState;
      if (state?.open && state.expires_in_seconds !== null) {
        this._baselineSeconds = state.expires_in_seconds;
        this._anchorMs = Date.now();
        this._startTick();
      } else {
        this._baselineSeconds = null;
        this._stopTick();
      }
    }
  }

  protected render() {
    const peers = this._peers;
    const pending = peers?.filter((p) => p.status === "pending") ?? [];
    return html`
      <div class="section-heading">
        ${this._localize("settings.build_server_pairing_requests_heading")}
        ${this._renderWindowStatus()}
      </div>
      <div class="section-intro">
        ${this._localize("settings.build_server_pairing_requests_desc")}
      </div>
      ${peers === null
        ? this._statusRow("settings.build_server_pairing_requests_loading")
        : pending.length === 0
          ? this._statusRow("settings.build_server_pairing_requests_empty")
          : pending.map((p) => this._renderPendingRow(p))}
      <esphome-accept-peer-dialog
        @confirm=${this._onAcceptConfirm}
        @reject=${this._onRejectFromDialog}
      ></esphome-accept-peer-dialog>
    `;
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

  private _renderWindowStatus() {
    const state = this._windowState;
    if (state === null) return nothing;
    if (!state.open) {
      return html`
        <span class="pairing-window-pill pairing-window-closed">
          ${this._localize("settings.build_server_pairing_window_closed")}
        </span>
      `;
    }
    const remaining = this._remainingSeconds();
    return html`
      <span class="pairing-window-pill pairing-window-open">
        ${this._localize("settings.build_server_pairing_window_open")}
      </span>
      ${remaining !== null
        ? html`
            <span
              class="pairing-window-countdown"
              aria-label=${this._localize(
                "settings.build_server_pairing_window_remaining_aria",
                { duration: this._formatDuration(remaining) }
              )}
            >
              ${this._formatDuration(remaining)}
            </span>
          `
        : nothing}
      <button type="button" class="pairing-window-extend" @click=${this._onExtend}>
        ${this._localize("settings.build_server_pairing_window_extend")}
      </button>
    `;
  }

  private _renderPendingRow(peer: PeerSummary) {
    return html`
      <div class="row peer-row peer-row-pending">
        <div class="row-label">
          <span class="row-title">${peer.label}</span>
          ${peer.peer_ip
            ? html`
                <span class="row-desc">
                  ${this._localize("settings.build_server_peer_ip_label")}
                  <code class="peer-ip">${peer.peer_ip}</code>
                </span>
              `
            : nothing}
        </div>
        <div class="peer-actions">
          <button
            type="button"
            aria-label=${this._localize("settings.build_server_peer_review_aria", {
              label: peer.label,
            })}
            @click=${() => this._onReviewRequest(peer)}
          >
            ${this._localize("settings.build_server_peer_review")}
          </button>
        </div>
      </div>
    `;
  }

  private _onReviewRequest(peer: PeerSummary) {
    this._acceptPeerDialog?.open(peer);
  }

  private async _onAcceptConfirm(e: CustomEvent<{ dashboardId: string }>) {
    if (this._api === undefined) return;
    const prefix = "settings.build_server_peer_approve";
    try {
      await this._api.approveRemoteBuildPeer({
        dashboard_id: e.detail.dashboardId,
      });
    } catch (err) {
      this._toastApiFailure(prefix, err);
      return;
    }
    this._toast("success", `${prefix}_success`);
  }

  private async _onRejectFromDialog(e: CustomEvent<{ dashboardId: string }>) {
    if (this._api === undefined) return;
    const prefix = "settings.build_server_peer_reject";
    try {
      await this._api.removeRemoteBuildPeer({
        dashboard_id: e.detail.dashboardId,
      });
    } catch (err) {
      this._toastApiFailure(prefix, err);
      return;
    }
    this._toast("success", `${prefix}_success`);
  }

  private _toastApiFailure(prefix: string, err: unknown) {
    if (err instanceof APIError) {
      if (err.errorCode === ErrorCode.NOT_FOUND) {
        this._toast("warning", `${prefix}_already_gone`);
        return;
      }
      if (err.details) {
        this._toast("error", `${prefix}_failed_detail`, {
          reason: err.details,
        });
        return;
      }
    }
    this._toast("error", `${prefix}_failed`);
  }

  private _onExtend = () => {
    if (this._api === undefined) return;
    void this._api.setRemoteBuildPairingWindow({ open: true }).catch(() => {
      this._toast("warning", "settings.build_server_pairing_window_extend_failed");
    });
  };

  private _startTick() {
    if (this._tickHandle !== null) return;
    this._tickHandle = setInterval(() => {
      this._tick = (this._tick + 1) % 1000;
    }, 1000);
  }

  private _stopTick() {
    if (this._tickHandle !== null) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
  }

  private _remainingSeconds(): number | null {
    return remainingOf(this._baselineSeconds, this._anchorMs, Date.now());
  }

  private _formatDuration(seconds: number | null): string {
    if (seconds === null) return "";
    const whole = Math.floor(seconds);
    const m = Math.floor(whole / 60);
    const s = whole % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  private _toast(
    level: "success" | "warning" | "error",
    key: string,
    values?: Record<string, string | number>
  ) {
    toast[level](this._localize(key, values), { richColors: true });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-pairing-requests": ESPHomeSettingsPairingRequests;
  }
}
