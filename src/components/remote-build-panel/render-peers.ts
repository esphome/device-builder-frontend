import { html, nothing, type TemplateResult } from "lit";
import type { PeerSummary } from "../../api/types/remote-build.js";
import { activeLocale } from "../../common/localize.js";
import { peerDisplayName } from "../../util/pairing-display-name.js";
import { pairedAgoSeconds, peerConnectionPill } from "../../util/peer-display.js";
import { formatSecondsAgo } from "../../util/relative-time.js";
import type { ESPHomeRemoteBuildPanel } from "../remote-build-panel.js";
import { renderPairingWindowStatus } from "../shared/pairing-window-status.js";

/** Pinned alert card for an incoming pairing request. */
export function renderRequestCard(
  host: ESPHomeRemoteBuildPanel,
  peer: PeerSummary
): TemplateResult {
  return html`
    <div class="request-card" role="alert">
      <wa-icon library="mdi" name="handshake"></wa-icon>
      <div class="request-body">
        <div class="request-title">
          ${host._localize("remote_build_dashboard.request_title", {
            label: peerDisplayName(peer),
          })}
        </div>
        ${
          peer.peer_ip
            ? html`
                <div class="request-meta">
                  ${host._localize("settings.build_server_peer_ip_label")}
                  <code>${peer.peer_ip}</code>
                </div>
              `
            : nothing
        }
      </div>
      <button
        type="button"
        class="primary-action"
        aria-label=${host._localize("settings.build_server_peer_review_aria", {
          label: peerDisplayName(peer),
        })}
        @click=${() => host._reviewRequest(peer)}
      >
        ${host._localize("remote_build_dashboard.request_review")}
      </button>
    </div>
  `;
}

/** Approved senders with live connected state; management stays in Settings.
 *  Manage sits in the heading, the peer list scrolls, and the pairing-window
 *  controls stay pinned to the card's bottom. */
export function renderPeersCard(
  host: ESPHomeRemoteBuildPanel,
  approved: PeerSummary[]
): TemplateResult {
  return html`
    <div class="card">
      <div class="card-heading">
        <span>${host._localize("remote_build_dashboard.peers_heading")}</span>
        <button
          type="button"
          class="heading-action heading-action--quiet"
          @click=${host._openBuildServerSettings}
        >
          ${host._localize("remote_build_dashboard.peers_manage")}
        </button>
      </div>
      <div class="card-window-row">
        ${renderPairingWindowStatus(
          host._localize,
          host._windowState,
          host._window.remainingSeconds(),
          host._extendWindow
        )}
        ${
          host._windowState?.open === true
            ? nothing
            : html`
                <button
                  type="button"
                  class="heading-action"
                  title=${host._localize("remote_build_dashboard.open_pairing_window_tooltip")}
                  @click=${host._openWindow}
                >
                  ${host._localize("remote_build_dashboard.open_pairing_window")}
                </button>
              `
        }
      </div>
      <div class="peer-list">${approved.map((p) => renderPeerRow(host, p))}</div>
    </div>
  `;
}

function renderPeerRow(host: ESPHomeRemoteBuildPanel, peer: PeerSummary): TemplateResult {
  const pill = peerConnectionPill(peer.connected);
  const pairedAgo = pairedAgoSeconds(peer.paired_at, host._now);
  return html`
    <div class="peer-line">
      <wa-icon library="mdi" name="monitor-dashboard"></wa-icon>
      <div class="peer-line-body">
        <span class="peer-line-title">${peerDisplayName(peer)}</span>
        ${
          pairedAgo !== null
            ? html`
                <span class="peer-line-meta">
                  ${host._localize("settings.build_server_peer_paired_at_label")}
                  ${formatSecondsAgo(pairedAgo, activeLocale())}
                </span>
              `
            : nothing
        }
      </div>
      <span class=${pill.className}>${host._localize(pill.labelKey)}</span>
    </div>
  `;
}
