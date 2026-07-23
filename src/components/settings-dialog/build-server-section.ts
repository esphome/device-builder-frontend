import { consume } from "@lit/context";
import { mdiClose } from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { notify } from "../../util/notify.js";

import { APIError } from "../../api/api-error.js";
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import { ErrorCode } from "../../api/types/protocol.js";
import {
  CLEANUP_TTL_DEFAULT_SECONDS,
  CLEANUP_TTL_MAX_SECONDS,
  CLEANUP_TTL_MIN_SECONDS,
  type PeerSummary,
} from "../../api/types/remote-build.js";
import { activeLocale, type LocalizeFunc } from "../../common/localize.js";
import {
  apiContext,
  buildServerIdentityRotationCounterContext,
  buildServerPeersContext,
  localizeContext,
  remoteBuildCleanupTtlContext,
  remoteBuildEnabledContext,
} from "../../context/index.js";
import { linkButtonStyles } from "../../styles/link-button.js";
import { pairingAddressStyles } from "../../styles/pairing-address.js";
import { peerRowStyles } from "../../styles/peer-rows.js";
import { pinHexStyles } from "../../styles/pin-hex.js";
import { espHomeStyles } from "../../styles/shared.js";
import { copyToClipboard } from "../../util/copy-to-clipboard.js";
import { fireEvent } from "../../util/fire-event.js";
import { pairingAddress } from "../../util/pairing-address.js";
import { renderPairingAddress } from "../shared/pairing-address.js";
import { formatPinSha256 } from "../../util/pin-format.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { pairedAgoSeconds, peerConnectionPill } from "../../util/peer-display.js";
import { peerDisplayName } from "../../util/pairing-display-name.js";
import { formatSecondsAgo } from "../../util/relative-time.js";
import { RemoteBuildIdentityController } from "../../util/remote-build-identity-controller.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";
import { buildServerCardStyles, cleanupTtlStyles } from "./build-server-styles.js";
import { renderStatusRow, renderToggleRow } from "./settings-rows.js";
import { settingsRowStyles, settingsSharedStyles } from "./shared-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../confirm-dialog.js";
import "../pin-emoji-grid.js";

registerMdiIcons({ close: mdiClose });

@customElement("esphome-settings-build-server")
export class ESPHomeSettingsBuildServer extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api?: ESPHomeAPI;

  @consume({ context: remoteBuildEnabledContext, subscribe: true })
  @state()
  private _remoteBuildEnabled = false;

  @consume({ context: remoteBuildCleanupTtlContext, subscribe: true })
  @state()
  private _remoteBuildCleanupTtl = CLEANUP_TTL_DEFAULT_SECONDS;

  @consume({ context: buildServerPeersContext, subscribe: true })
  @state()
  private _peers: PeerSummary[] | null = null;

  @consume({
    context: buildServerIdentityRotationCounterContext,
    subscribe: true,
  })
  @state()
  private _rotationCounter = 0;

  private readonly _identityCtrl = new RemoteBuildIdentityController(
    this,
    () => this._api
  );

  @state()
  private _rotateInFlight = false;

  @state()
  private _pendingPeerRemove: { dashboardId: string } | null = null;

  @query("#rotate-confirm")
  private _rotateConfirmDialog!: ESPHomeConfirmDialog;

  @query("#peer-remove-confirm")
  private _peerRemoveConfirmDialog!: ESPHomeConfirmDialog;

  static styles = [
    espHomeStyles,
    pinHexStyles,
    pairingAddressStyles,
    settingsSharedStyles,
    settingsRowStyles,
    peerRowStyles,
    buildServerCardStyles,
    cleanupTtlStyles,
    linkButtonStyles,
  ];

  protected updated(changed: Map<string, unknown>) {
    super.updated(changed);
    // Cross-tab rotate: another tab fired remote_build_identity_rotated;
    // refresh the local card so it matches what's on disk now.
    if (
      changed.has("_rotationCounter") &&
      changed.get("_rotationCounter") !== undefined
    ) {
      this._identityCtrl.onRotationCounterChanged();
    }
  }

  protected render() {
    return html`
      ${renderToggleRow(this._localize, {
        titleId: "remote-build-enable-title",
        titleKey: "settings.remote_build_enable",
        descKey: "settings.remote_build_enable_desc",
        checked: this._remoteBuildEnabled,
        onToggle: this._onToggleEnabled,
      })}
      ${this._renderApprovedPeers()} ${this._renderPeerRemoveConfirmDialog()}

      <div class="section-heading">
        ${this._localize("settings.build_server_card_heading")}
      </div>
      <div class="section-intro">
        ${this._localize("settings.build_server_card_desc")}
      </div>
      ${this._renderCard()} ${this._renderCleanupTtlRow()}
    `;
  }

  private _renderApprovedPeers() {
    const peers = this._peers;
    const approved = peers?.filter((p) => p.status === "approved") ?? [];
    return html`
      <div class="section-heading">
        ${this._localize("settings.build_server_paired_senders_heading")}
      </div>
      <div class="section-intro">
        ${this._localize("settings.build_server_paired_senders_desc")}
      </div>
      ${
        peers === null
          ? renderStatusRow(
              this._localize,
              "settings.build_server_paired_senders_loading"
            )
          : approved.length === 0
            ? renderStatusRow(
                this._localize,
                "settings.build_server_paired_senders_empty"
              )
            : approved.map((p) => this._renderApprovedPeerRow(p))
      }
    `;
  }

  private _renderApprovedPeerRow(peer: PeerSummary) {
    const pill = peerConnectionPill(peer.connected);
    // ``paired_at`` is a Unix-seconds timestamp from the receiver's clock
    // at approval time, rendered as a relative "paired N days ago" so the
    // wording localises through ``Intl.RelativeTimeFormat``.
    const pairedAgo = pairedAgoSeconds(peer.paired_at, Date.now());
    return html`
      <div class="row peer-row peer-row-approved">
        <div class="row-label">
          <span class="row-title">
            ${peerDisplayName(peer)}
            <span class=${pill.className}>${this._localize(pill.labelKey)}</span>
          </span>
          <!--
            "Show details" disclosure. Matches the
            details.pin-hex pattern used elsewhere in this
            section so the visual behaviour is consistent.
            The opaque dashboard_id used to render directly
            under the label; users have no use for it
            day-to-day (the label + emoji fingerprint cover
            identification + verification) so it's now tucked
            here alongside the more useful paired-N-ago and
            peer_ip fields.
          -->
          <details class="peer-details">
            <summary>
              ${this._localize("settings.build_server_peer_details_summary")}
            </summary>
            <dl class="peer-details-list">
              ${
                pairedAgo !== null
                  ? html`
                      <dt>
                        ${this._localize("settings.build_server_peer_paired_at_label")}
                      </dt>
                      <dd>${formatSecondsAgo(pairedAgo, activeLocale())}</dd>
                    `
                  : nothing
              }
              ${
                peer.peer_ip
                  ? html`
                      <dt>${this._localize("settings.build_server_peer_ip_label")}</dt>
                      <dd><code>${peer.peer_ip}</code></dd>
                    `
                  : nothing
              }
              <dt>${this._localize("settings.build_server_peer_dashboard_id_label")}</dt>
              <dd>
                <code class="peer-dashboard-id">${peer.dashboard_id}</code>
                <span class="peer-details-desc">
                  ${this._localize("settings.build_server_peer_dashboard_id_desc")}
                </span>
              </dd>
            </dl>
          </details>
        </div>
        <button
          type="button"
          class="peer-remove"
          aria-label=${this._localize("settings.build_server_peer_remove_aria", {
            label: peerDisplayName(peer),
          })}
          title=${this._localize("settings.build_server_peer_remove")}
          @click=${() => this._onRemovePeerRequest(peer.dashboard_id)}
        >
          <wa-icon library="mdi" name="delete"></wa-icon>
        </button>
      </div>
    `;
  }

  private _renderPeerRemoveConfirmDialog() {
    const prefix = "settings.build_server_peer_remove_confirm";
    return html`
      <esphome-confirm-dialog
        id="peer-remove-confirm"
        destructive
        heading=${this._localize(`${prefix}_title`)}
        message=${this._localize(`${prefix}_body`)}
        confirm-label=${this._localize(`${prefix}_confirm`)}
        @confirm=${this._onRemovePeerConfirm}
      ></esphome-confirm-dialog>
    `;
  }

  private _renderCard() {
    if (this._identityCtrl.loadFailed) {
      return renderStatusRow(
        this._localize,
        "settings.remote_build_identity_load_failed",
        "alert"
      );
    }
    if (this._identityCtrl.identity === null) {
      return renderStatusRow(this._localize, "settings.remote_build_identity_loading");
    }
    const identity = this._identityCtrl.identity;
    const formattedPin = formatPinSha256(identity.pin_sha256);
    const address = pairingAddress(identity);
    return html`
      <div class="build-server-card">
        <div class="build-server-row build-server-row--pin">
          <span class="build-server-label">
            ${this._localize("settings.remote_build_pin_label")}
          </span>
          <div class="build-server-pin-display">
            <esphome-pin-emoji-grid .pin=${identity.pin_sha256}></esphome-pin-emoji-grid>
            <details class="pin-hex">
              <summary>
                ${this._localize("settings.remote_build_pin_hex_summary")}
              </summary>
              <code class="build-server-pin">${formattedPin}</code>
            </details>
          </div>
        </div>
        <div class="build-server-actions">
          <button class="build-server-copy" type="button" @click=${this._onCopyPin}>
            ${this._localize("settings.remote_build_pin_copy")}
          </button>
          ${this._renderListenerBadge(identity.listener_bound)}
        </div>
        <div class="build-server-row">
          <span class="build-server-label">
            ${this._localize("settings.remote_build_dashboard_id_label")}
          </span>
          <code class="build-server-dashboard-id">${identity.dashboard_id}</code>
        </div>
        ${
          address
            ? html`
                <div class="build-server-row">
                  <span class="build-server-label">
                    ${this._localize("settings.remote_build_address_label")}
                  </span>
                  ${renderPairingAddress(this._localize, identity)}
                </div>
              `
            : nothing
        }
        <div class="build-server-row build-server-versions">
          <span>
            ${this._localize("settings.remote_build_server_version_label")}
            <code>${identity.server_version}</code>
          </span>
          <span>
            ${this._localize("settings.remote_build_esphome_version_label")}
            <code>${identity.esphome_version}</code>
          </span>
        </div>
        <div class="build-server-actions">
          <button
            class="build-server-rotate"
            type="button"
            ?disabled=${this._rotateInFlight}
            @click=${this._onRotateRequest}
          >
            ${
              this._rotateInFlight
                ? this._localize("settings.remote_build_rotate_in_progress")
                : this._localize("settings.remote_build_rotate")
            }
          </button>
        </div>
      </div>
      <esphome-confirm-dialog
        id="rotate-confirm"
        destructive
        heading=${this._localize("settings.remote_build_rotate_confirm_title")}
        message=${this._localize("settings.remote_build_rotate_confirm_body")}
        confirm-label=${this._localize("settings.remote_build_rotate_confirm_confirm")}
        @confirm=${this._onRotateConfirm}
      ></esphome-confirm-dialog>
    `;
  }

  // Disabled is intentional state, not a fault: it reads neutral with a
  // direct turn-on action, so the red "offline" only ever means an enabled
  // listener that failed to bind.
  private _renderListenerBadge(listenerBound: boolean) {
    if (!this._remoteBuildEnabled) {
      return html`
        <span class="build-server-listener-badge build-server-listener-disabled">
          <span role="status">
            ${this._localize("settings.remote_build_listener_disabled")}
          </span>
          <button
            class="link-button"
            type="button"
            aria-label=${this._localize("settings.remote_build_listener_turn_on_aria")}
            @click=${this._onToggleEnabled}
          >
            ${this._localize("settings.remote_build_listener_turn_on")}
          </button>
        </span>
      `;
    }
    return html`
      <span
        class=${`build-server-listener-badge build-server-listener-${
          listenerBound ? "up" : "down"
        }`}
        role="status"
      >
        ${
          listenerBound
            ? this._localize("settings.remote_build_listener_up")
            : this._localize("settings.remote_build_listener_down")
        }
      </span>
    `;
  }

  private _renderCleanupTtlRow() {
    const hours = Math.round(this._remoteBuildCleanupTtl / 3600);
    const minHours = CLEANUP_TTL_MIN_SECONDS / 3600;
    const maxHours = CLEANUP_TTL_MAX_SECONDS / 3600;
    return html`
      <div class="row row--stacked">
        <div class="row-label">
          <span id="remote-build-cleanup-ttl-title" class="row-title">
            ${this._localize("settings.remote_build_cleanup_ttl_title")}
          </span>
          <span class="row-desc">
            ${this._localize("settings.remote_build_cleanup_ttl_desc")}
          </span>
        </div>
        <div class="cleanup-ttl-input">
          <input
            id="remote-build-cleanup-ttl"
            class="cleanup-ttl-number"
            type="number"
            min=${minHours}
            max=${maxHours}
            step="1"
            aria-labelledby="remote-build-cleanup-ttl-title"
            .value=${String(hours)}
            @change=${this._onCommitCleanupTtl}
          />
          <span class="cleanup-ttl-unit">
            ${this._localize("settings.remote_build_cleanup_ttl_unit")}
          </span>
        </div>
      </div>
    `;
  }

  private _toast(
    level: "success" | "warning" | "error",
    key: string,
    values?: Record<string, string | number>
  ) {
    notify[level](this._localize(key, values));
  }

  private _onToggleEnabled() {
    fireEvent(this, "set-remote-build-enabled", !this._remoteBuildEnabled);
    return nothing;
  }

  private _onRemovePeerRequest(dashboardId: string) {
    this._pendingPeerRemove = { dashboardId };
    this._peerRemoveConfirmDialog?.open();
  }

  private async _onRemovePeerConfirm() {
    const action = this._pendingPeerRemove;
    this._pendingPeerRemove = null;
    if (this._api === undefined || action === null) return;
    const prefix = "settings.build_server_peer_remove";
    try {
      await this._api.removeRemoteBuildPeer({ dashboard_id: action.dashboardId });
    } catch (err) {
      if (err instanceof APIError && err.errorCode === ErrorCode.NOT_FOUND) {
        this._toast("warning", `${prefix}_already_gone`);
      } else {
        this._toast("error", `${prefix}_failed`);
      }
      return;
    }
    this._toast("success", `${prefix}_success`);
  }

  private _onRotateRequest() {
    this._rotateConfirmDialog?.open();
  }

  private async _onRotateConfirm() {
    if (this._api === undefined || this._rotateInFlight) return;
    this._rotateInFlight = true;
    try {
      this._identityCtrl.set(await this._api.rotateRemoteBuildIdentity());
      // An unbound listener is expected while remote build is disabled;
      // only warn when it should have been up.
      if (this._identityCtrl.identity?.listener_bound || !this._remoteBuildEnabled) {
        this._toast("success", "settings.remote_build_rotate_success");
      } else {
        this._toast("warning", "settings.remote_build_rotate_listener_down");
      }
    } catch (err) {
      if (err instanceof APIError && err.errorCode === ErrorCode.ALREADY_EXISTS) {
        this._toast("warning", "settings.remote_build_rotate_already_in_progress");
      } else {
        this._toast("error", "settings.remote_build_rotate_failed");
      }
    } finally {
      this._rotateInFlight = false;
    }
  }

  private async _onCopyPin() {
    const pin = this._identityCtrl.identity?.pin_sha256;
    if (!pin) {
      this._toast("warning", "settings.remote_build_pin_copy_failed");
      return;
    }
    // Copy the unformatted pin so a paste into a compare field
    // doesn't pick up the OOB display spacing. copyToClipboard()
    // falls back to execCommand for HTTP/non-secure contexts.
    if (await copyToClipboard(pin)) {
      this._toast("success", "settings.remote_build_pin_copied");
    } else {
      this._toast("warning", "settings.remote_build_pin_copy_failed");
    }
  }

  private _onCommitCleanupTtl = (e: Event): void => {
    const input = e.target as HTMLInputElement;
    const hoursRaw = Number.parseInt(input.value, 10);
    const minHours = CLEANUP_TTL_MIN_SECONDS / 3600;
    const maxHours = CLEANUP_TTL_MAX_SECONDS / 3600;
    let hours: number;
    if (!Number.isFinite(hoursRaw)) {
      hours =
        Math.round(this._remoteBuildCleanupTtl / 3600) ||
        CLEANUP_TTL_DEFAULT_SECONDS / 3600;
    } else {
      hours = Math.max(minHours, Math.min(maxHours, hoursRaw));
    }
    input.value = String(hours);
    const seconds = hours * 3600;
    if (seconds === this._remoteBuildCleanupTtl) return;
    this.dispatchEvent(
      new CustomEvent<number>("set-remote-build-cleanup-ttl", {
        detail: seconds,
        bubbles: true,
        composed: true,
      })
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-build-server": ESPHomeSettingsBuildServer;
  }
}
