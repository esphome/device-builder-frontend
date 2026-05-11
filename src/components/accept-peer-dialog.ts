import { consume } from "@lit/context";
import { mdiShieldAlertOutline } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import type { PeerSummary } from "../api/types.js";
import { localizeContext } from "../context/index.js";
import { pinHexStyles } from "../styles/pin-hex.js";
import { espHomeStyles } from "../styles/shared.js";
import { formatPinSha256 } from "../util/cert-pin-format.js";
import { registerMdiIcons } from "../util/register-icons.js";
import "./confirm-dialog.js";
import type { ESPHomeConfirmDialog } from "./confirm-dialog.js";
import "./pin-emoji-grid.js";

// Register the shield-alert icon so the shared confirm-dialog's
// destructive icon-wrap can resolve it via the icon override; the
// shield framing reads as "security decision" rather than the
// generic "destructive action" alert-outline default.
registerMdiIcons({ "shield-alert-outline": mdiShieldAlertOutline });

/**
 * Decision dialog for a pending pairing request from a remote
 * sender (the receiver-side "Review" path on the Build server
 * section of Settings).
 *
 * Accepting a request grants the remote dashboard the ability to
 * dispatch compile jobs to this host, which the operator should
 * treat as full code-execution access; surface that risk up-front
 * rather than letting the inline list-row commit the decision in
 * one click. The dialog re-shows the OOB fingerprint so the
 * operator can sanity-check it against the sender's display
 * before accepting; the inline pin on the row would be convenient
 * for at-a-glance scanning, but a deliberate decision step is what
 * protects against misclick or "accept everything" muscle memory.
 *
 * Composes the shared ``<esphome-confirm-dialog>``: rich body via
 * the ``body`` slot, primary destructive Accept via ``confirm``,
 * neutral Reject via the secondary action. Re-emits the inner
 * dialog's events as ``confirm`` and ``reject`` carrying the peer's
 * ``dashboard_id`` so the parent doesn't need to track which row
 * the dialog was opened with.
 */
@customElement("esphome-accept-peer-dialog")
export class ESPHomeAcceptPeerDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property({ attribute: false })
  peer: PeerSummary | null = null;

  @query("esphome-confirm-dialog")
  private _confirmDialog!: ESPHomeConfirmDialog;

  static styles = [
    espHomeStyles,
    pinHexStyles,
    css`
      .warning {
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-normal);
        margin-bottom: var(--wa-space-s);
      }

      .checklist {
        margin: var(--wa-space-s) 0 var(--wa-space-m);
        padding-left: var(--wa-space-m);
      }

      .checklist li {
        margin-bottom: 4px;
      }

      .peer-card {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
        padding: var(--wa-space-m);
        margin: var(--wa-space-s) 0 var(--wa-space-m);
        background: var(--wa-color-surface-lowered);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
      }

      .peer-row {
        display: flex;
        gap: var(--wa-space-s);
        font-size: var(--wa-font-size-s);
        flex-wrap: wrap;
      }

      .peer-row .label {
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-quiet);
        min-width: 96px;
      }

      .peer-row .value,
      .peer-pin {
        font-family: var(--wa-font-family-mono, monospace);
        word-break: break-all;
        color: var(--wa-color-text-normal);
        flex: 1;
      }

      .peer-name {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .pin-block {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .pin-block .label {
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }

      .peer-pin {
        font-size: var(--wa-font-size-s);
        line-height: 1.5;
      }

      /* Hex bytes collapsed under a disclosure so the emoji row
         is the primary signal; the hex stays one click away for
         operators who want to verify the cryptographic form,
         without competing for attention with the picture row.
         Base styling lives in styles/pin-hex.ts; the rules
         below are dialog-specific extras (separator margin
         above the disclosure, monospace + word-break for the
         hex bytes themselves). */
      .pin-hex {
        margin-top: var(--wa-space-s);
      }

      .pin-hex code {
        font-family: var(--wa-font-family-mono, monospace);
        word-break: break-all;
      }
    `,
  ];

  open(peer: PeerSummary) {
    this.peer = peer;
    this._confirmDialog?.open();
  }

  close() {
    this._confirmDialog?.close();
  }

  protected render() {
    const peer = this.peer;
    const formattedPin = peer ? formatPinSha256(peer.pin_sha256) : "";
    return html`
      <esphome-confirm-dialog
        destructive
        icon="shield-alert-outline"
        heading=${this._localize("settings.build_server_peer_accept_confirm_title")}
        confirm-label=${this._localize(
          "settings.build_server_peer_accept_confirm_confirm"
        )}
        secondary-label=${this._localize(
          "settings.build_server_peer_accept_confirm_reject"
        )}
        @confirm=${this._onAccept}
        @secondary=${this._onReject}
      >
        <div slot="body">
          <div class="warning">
            ${this._localize("settings.build_server_peer_accept_confirm_warning")}
          </div>
          <ul class="checklist">
            <li>
              ${this._localize(
                "settings.build_server_peer_accept_confirm_checklist_pin"
              )}
            </li>
            <li>
              ${this._localize(
                "settings.build_server_peer_accept_confirm_checklist_access"
              )}
            </li>
          </ul>
          ${peer
            ? html`
                <div class="peer-card">
                  <div class="peer-name">${peer.label}</div>
                  <div class="peer-row">
                    <span class="label">
                      ${this._localize(
                        "settings.build_server_peer_accept_confirm_dashboard_id"
                      )}
                    </span>
                    <code class="value">${peer.dashboard_id}</code>
                  </div>
                  ${peer.peer_ip
                    ? html`
                        <div class="peer-row">
                          <span class="label">
                            ${this._localize(
                              "settings.build_server_peer_ip_label"
                            )}
                          </span>
                          <code class="value">${peer.peer_ip}</code>
                        </div>
                      `
                    : nothing}
                  <div class="pin-block">
                    <span class="label">
                      ${this._localize(
                        "settings.build_server_peer_accept_confirm_pin_label"
                      )}
                    </span>
                    <esphome-pin-emoji-grid
                      .pin=${peer.pin_sha256}
                    ></esphome-pin-emoji-grid>
                    <details class="pin-hex">
                      <summary>
                        ${this._localize(
                          "settings.build_server_peer_accept_confirm_pin_hex_summary"
                        )}
                      </summary>
                      <code class="peer-pin">${formattedPin}</code>
                    </details>
                  </div>
                </div>
              `
            : nothing}
        </div>
      </esphome-confirm-dialog>
    `;
  }

  private _onAccept() {
    if (this.peer === null) return;
    this.dispatchEvent(
      new CustomEvent("confirm", {
        detail: { dashboardId: this.peer.dashboard_id },
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onReject() {
    if (this.peer === null) return;
    this.dispatchEvent(
      new CustomEvent("reject", {
        detail: { dashboardId: this.peer.dashboard_id },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-accept-peer-dialog": ESPHomeAcceptPeerDialog;
  }
}
