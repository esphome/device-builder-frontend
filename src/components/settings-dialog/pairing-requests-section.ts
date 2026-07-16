import { consume } from "@lit/context";
import { LitElement, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { notify } from "../../util/notify.js";

import type { ESPHomeAPI } from "../../api/esphome-api.js";
import type { PairingWindowState, PeerSummary } from "../../api/types/remote-build.js";
import { peerDisplayName } from "../../util/pairing-display-name.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  apiContext,
  buildServerPairingWindowStateContext,
  buildServerPeersContext,
  localizeContext,
} from "../../context/index.js";
import { pairingWindowStyles } from "../../styles/pairing-window.js";
import { peerRowStyles } from "../../styles/peer-rows.js";
import { espHomeStyles } from "../../styles/shared.js";
import { PairingWindowController } from "../../util/pairing-window-controller.js";
import {
  approvePeerRequest,
  rejectPeerRequest,
} from "../../util/peer-pairing-actions.js";
import type { ESPHomeAcceptPeerDialog } from "../accept-peer-dialog.js";
import { renderPairingWindowStatus } from "../shared/pairing-window-status.js";
import { renderStatusRow } from "./settings-rows.js";
import { settingsRowStyles, settingsSharedStyles } from "./shared-styles.js";

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

  // Auto-open: intent="pair_request" Noise frames are accepted while the
  // operator is on this screen. Refcounted server-side; closes on
  // disconnect or 5min idle.
  private readonly _window = new PairingWindowController(this, {
    getApi: () => this._api,
    autoOpen: true,
    onOpenFailed: () =>
      notify.warning(this._localize("settings.build_server_pairing_window_open_failed")),
    onExtendFailed: () =>
      notify.warning(
        this._localize("settings.build_server_pairing_window_extend_failed")
      ),
  });

  @query("esphome-accept-peer-dialog")
  private _acceptPeerDialog!: ESPHomeAcceptPeerDialog;

  static styles = [
    espHomeStyles,
    settingsSharedStyles,
    settingsRowStyles,
    peerRowStyles,
    pairingWindowStyles,
  ];

  protected updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (changed.has("_windowState")) {
      this._window.onStateChanged(this._windowState);
    }
  }

  protected render() {
    const peers = this._peers;
    const pending = peers?.filter((p) => p.status === "pending") ?? [];
    return html`
      <div class="section-heading">
        ${this._localize("settings.build_server_pairing_requests_heading")}
        ${renderPairingWindowStatus(
          this._localize,
          this._windowState,
          this._window.remainingSeconds(),
          this._onExtend
        )}
      </div>
      <div class="section-intro">
        ${this._localize("settings.build_server_pairing_requests_desc")}
      </div>
      ${
        peers === null
          ? renderStatusRow(
              this._localize,
              "settings.build_server_pairing_requests_loading"
            )
          : pending.length === 0
            ? renderStatusRow(
                this._localize,
                "settings.build_server_pairing_requests_empty"
              )
            : pending.map((p) => this._renderPendingRow(p))
      }
      <esphome-accept-peer-dialog
        @confirm=${this._onAcceptConfirm}
        @reject=${this._onRejectFromDialog}
      ></esphome-accept-peer-dialog>
    `;
  }

  private _renderPendingRow(peer: PeerSummary) {
    return html`
      <div class="row peer-row peer-row-pending">
        <div class="row-label">
          <span class="row-title">${peerDisplayName(peer)}</span>
          ${
            peer.peer_ip
              ? html`
                  <span class="row-desc">
                    ${this._localize("settings.build_server_peer_ip_label")}
                    <code class="peer-ip">${peer.peer_ip}</code>
                  </span>
                `
              : nothing
          }
        </div>
        <div class="peer-actions">
          <button
            type="button"
            aria-label=${this._localize("settings.build_server_peer_review_aria", {
              label: peerDisplayName(peer),
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
    await approvePeerRequest(this._api, this._localize, e.detail.dashboardId);
  }

  private async _onRejectFromDialog(e: CustomEvent<{ dashboardId: string }>) {
    if (this._api === undefined) return;
    await rejectPeerRequest(this._api, this._localize, e.detail.dashboardId);
  }

  private _onExtend = () => {
    this._window.extend();
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-pairing-requests": ESPHomeSettingsPairingRequests;
  }
}
