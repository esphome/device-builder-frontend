import { consume } from "@lit/context";
import { mdiClose } from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import toast from "sonner-js";

import { APIError } from "../../api/api-error.js";
import type { ESPHomeAPI } from "../../api/esphome-api.js";
import {
  CLEANUP_TTL_DEFAULT_SECONDS,
  CLEANUP_TTL_MAX_SECONDS,
  CLEANUP_TTL_MIN_SECONDS,
  ErrorCode,
  type IdentityView,
  type PeerSummary,
} from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  apiContext,
  buildServerIdentityRotationCounterContext,
  buildServerPeersContext,
  localizeContext,
  remoteBuildCleanupTtlContext,
  remoteBuildEnabledContext,
} from "../../context/index.js";
import { pinHexStyles } from "../../styles/pin-hex.js";
import { espHomeStyles } from "../../styles/shared.js";
import { copyToClipboard } from "../../util/copy-to-clipboard.js";
import { formatPinSha256 } from "../../util/pin-format.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import type { ESPHomeConfirmDialog } from "../confirm-dialog.js";
import { buildServerCardStyles, cleanupTtlStyles } from "./build-server-styles.js";
import {
  peerRowStyles,
  settingsRowStyles,
  settingsSharedStyles,
} from "./shared-styles.js";

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

  @state()
  private _identity: IdentityView | null = null;

  @state()
  private _identityLoadFailed = false;

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
    settingsSharedStyles,
    settingsRowStyles,
    peerRowStyles,
    buildServerCardStyles,
    cleanupTtlStyles,
  ];

  connectedCallback() {
    super.connectedCallback();
    void this._loadIdentity();
  }

  protected updated(changed: Map<string, unknown>) {
    super.updated(changed);
    // Cross-tab rotate: another tab fired remote_build_identity_rotated;
    // refresh the local card so it matches what's on disk now.
    if (
      changed.has("_rotationCounter") &&
      changed.get("_rotationCounter") !== undefined
    ) {
      void this._loadIdentity();
    }
  }

  protected render() {
    return html`
      <div class="row">
        <div class="row-label">
          <span id="remote-build-enable-title" class="row-title">
            ${this._localize("settings.remote_build_enable")}
          </span>
          <span class="row-desc">
            ${this._localize("settings.remote_build_enable_desc")}
          </span>
        </div>
        <button
          class="toggle"
          role="switch"
          aria-labelledby="remote-build-enable-title"
          aria-checked=${this._remoteBuildEnabled}
          @click=${this._onToggleEnabled}
        ></button>
      </div>

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
      ${peers === null
        ? this._loadingRow("settings.build_server_paired_senders_loading")
        : approved.length === 0
          ? this._loadingRow("settings.build_server_paired_senders_empty")
          : approved.map((p) => this._renderApprovedPeerRow(p))}
    `;
  }

  private _loadingRow(key: string) {
    return html`
      <div class="row" role="status">
        <div class="row-label">
          <span class="row-desc">${this._localize(key)}</span>
        </div>
      </div>
    `;
  }

  private _renderApprovedPeerRow(peer: PeerSummary) {
    const connectedClass = peer.connected
      ? "peer-connection-connected"
      : "peer-connection-disconnected";
    const connectedLabel = peer.connected
      ? this._localize("settings.build_server_peer_connected")
      : this._localize("settings.build_server_peer_disconnected");
    return html`
      <div class="row peer-row peer-row-approved">
        <div class="row-label">
          <span class="row-title">
            ${peer.label}
            <span class=${`peer-connection-pill ${connectedClass}`}>
              ${connectedLabel}
            </span>
          </span>
          <span class="row-desc">
            <code class="peer-dashboard-id">${peer.dashboard_id}</code>
          </span>
        </div>
        <button
          type="button"
          class="peer-remove"
          aria-label=${this._localize("settings.build_server_peer_remove_aria", {
            label: peer.label,
          })}
          @click=${() => this._onRemovePeerRequest(peer.dashboard_id)}
        >
          ${this._localize("settings.build_server_peer_remove")}
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
    if (this._identityLoadFailed) {
      return html`
        <div class="row" role="alert">
          <div class="row-label">
            <span class="row-desc">
              ${this._localize("settings.remote_build_identity_load_failed")}
            </span>
          </div>
        </div>
      `;
    }
    if (this._identity === null) {
      return this._loadingRow("settings.remote_build_identity_loading");
    }
    const identity = this._identity;
    const formattedPin = formatPinSha256(identity.pin_sha256);
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
          <span
            class=${`build-server-listener-badge build-server-listener-${
              identity.listener_bound ? "up" : "down"
            }`}
            role="status"
          >
            ${identity.listener_bound
              ? this._localize("settings.remote_build_listener_up")
              : this._localize("settings.remote_build_listener_down")}
          </span>
        </div>
        <div class="build-server-row">
          <span class="build-server-label">
            ${this._localize("settings.remote_build_dashboard_id_label")}
          </span>
          <code class="build-server-dashboard-id">${identity.dashboard_id}</code>
        </div>
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
            ${this._rotateInFlight
              ? this._localize("settings.remote_build_rotate_in_progress")
              : this._localize("settings.remote_build_rotate")}
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

  private _renderCleanupTtlRow() {
    const hours = Math.round(this._remoteBuildCleanupTtl / 3600);
    const minHours = CLEANUP_TTL_MIN_SECONDS / 3600;
    const maxHours = CLEANUP_TTL_MAX_SECONDS / 3600;
    return html`
      <div class="row">
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

  private async _loadIdentity(): Promise<void> {
    if (this._api === undefined) return;
    try {
      this._identity = await this._api.getRemoteBuildIdentity();
      this._identityLoadFailed = false;
    } catch (err) {
      console.warn("Could not load remote-build identity:", err);
      this._identityLoadFailed = true;
    }
  }

  private _toast(
    level: "success" | "warning" | "error",
    key: string,
    values?: Record<string, string | number>
  ) {
    toast[level](this._localize(key, values), { richColors: true });
  }

  private _onToggleEnabled() {
    this.dispatchEvent(
      new CustomEvent("set-remote-build-enabled", {
        detail: !this._remoteBuildEnabled,
        bubbles: true,
        composed: true,
      })
    );
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
      this._identity = await this._api.rotateRemoteBuildIdentity();
      this._identityLoadFailed = false;
      if (this._identity.listener_bound) {
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
    const pin = this._identity?.pin_sha256;
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
