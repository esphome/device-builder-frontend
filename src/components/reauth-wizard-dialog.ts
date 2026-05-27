import { consume } from "@lit/context";
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { OffloaderPinMismatchAlert, PairingSummary } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { dialogActionButtonStyles } from "../styles/dialog-action-buttons.js";
import { pinHexStyles } from "../styles/pin-hex.js";
import { espHomeStyles } from "../styles/shared.js";
import { friendlyHostname, trimTrailingDot } from "../util/hostname.js";
import { formatPinSha256 } from "../util/pin-format.js";
import {
  buildReauthPairRequest,
  classifyReauthError,
} from "./reauth-wizard-dialog-helpers.js";
import { reauthWizardDialogStyles } from "./reauth-wizard-dialog-styles.js";

import "./base-dialog.js";
import "./pin-emoji-grid.js";

type Step = 1 | 2 | 3;

/**
 * Multi-step re-authentication walk-through for a
 * pin_mismatch alert.
 *
 * The dashboard fired this alert because the receiver at
 * (hostname, port) responded with a different cryptographic
 * identity than the one OOB-verified at pair time. That has
 * two completely different real-world causes: the receiver
 * admin rotated the identity legitimately (identity rotation,
 * OS reinstall, server rebuild), or something is impersonating
 * the receiver. The operator faces a real decision that the
 * existing alert banner's one-line "Re-pair" CTA doesn't
 * walk them through.
 *
 * The wizard frames the decision in three explanatory steps
 * before letting the operator commit:
 *
 * 1. **What we noticed.** Shows the previously-confirmed
 *    fingerprint (``expected_pin``) next to the
 *    newly-observed one (``observed_pin``) as emoji grids so
 *    the difference is visible at a glance.
 * 2. **What this could mean.** Two side-by-side scenarios —
 *    legitimate rotation vs impersonation — so the operator
 *    sees both before they pick. No hidden "which is more
 *    likely?" framing; the goal is informed consent.
 * 3. **Verify with the receiver admin.** Action items: open
 *    the receiver's Settings → Build server card, compare the
 *    fingerprint the receiver shows for itself against the
 *    new one rendered here. A required checkbox gates the
 *    Re-pair button so the operator can't bypass the
 *    verification step.
 *
 * Pressing **Re-pair this receiver** on step 3 calls
 * 'requestRemoteBuildPair' inline -- the wizard itself owns
 * the cryptographic binding. The pin_sha256 arg is taken
 * from 'alert.observed_pin' (the value the operator
 * OOB-verified at step 1), so the backend's TOCTOU defense
 * at request_pair compares its live handshake to the same
 * pubkey the operator just verified. No separate pair
 * dialog and no second 'preview_pair' observation -- the
 * wizard's verification IS the verification.
 *
 * Outcomes:
 *
 * - Success: dispatches 'pair-request-sent' with the
 *   returned PairingSummary so app-shell upserts the row
 *   into 'buildOffloadPairings' (the backend doesn't fire
 *   OFFLOADER_PAIR_STATUS_CHANGED on a re-pair against an
 *   already-APPROVED row whose pin rotated under it -- the
 *   status didn't change, only the pubkey did). Then
 *   dispatches 'reauth-result' with
 *   '{outcome: "success", receiver_label}' so the parent
 *   toasts a re-pair-specific success message.
 * - PRECONDITION_FAILED: the receiver's live pubkey
 *   differs from observed_pin. The operator's step-1
 *   verification is stale -- forcing them back to the alert
 *   to OOB the fresh pin is correct. Wizard closes; parent
 *   toasts the 'fingerprint changed AGAIN' message.
 * - NO_PAIRING_WINDOW / UNAVAILABLE: the verification is
 *   still valid; the wizard keeps step 3 open with an
 *   inline error block and the primary action retitles to
 *   'Try again'.
 *
 * Pre-rewrite the wizard dispatched 'reauth-confirmed' with
 * {hostname, port} only -- observed_pin was dropped -- and a
 * separate pair dialog re-ran 'preview_pair' to capture a
 * fresh pubkey before binding. The window between the
 * wizard's step-1 verification and the pair dialog's
 * confirm step could be hours, during which mDNS / DHCP /
 * ARP could rebind the hostname to an attacker, and the
 * operator would cryptographically pin whatever the pair
 * dialog observed -- not what they had verified. Wiring the
 * request_pair call into the wizard directly closes that
 * window.
 *
 * peer_revoked alerts are deliberately not handled by this
 * wizard — they only have one operator-actionable outcome
 * (Unpair, since the receiver explicitly removed the
 * pairing) and the existing banner is already a clear
 * walk-through. Adding a three-step explainer in front of a
 * single Unpair button would be process for its own sake.
 */
@customElement("esphome-reauth-wizard-dialog")
export class ESPHomeReauthWizardDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api?: ESPHomeAPI;

  @state() private _open = false;
  @state() private _step: Step = 1;
  @state() private _alert: OffloaderPinMismatchAlert | null = null;
  /** Step-3 checkbox state: gates the Re-pair button so the
   *  operator can't bypass the "I've checked with the receiver
   *  admin" acknowledgment. Resets on every ``open()``. */
  @state() private _verified = false;
  /** True while request_pair is in flight. Disables the
   *  action buttons so the operator can't double-fire and so
   *  the inline "Try again" CTA stays visible across the
   *  retry round-trip. */
  @state() private _busy = false;
  /** Inline error on step 3 when request_pair returned a
   *  retryable failure (NO_PAIRING_WINDOW, UNAVAILABLE, or
   *  generic). Held as a translation key so localize fires
   *  on render. ``null`` means "no error to show". Terminal
   *  failures (PRECONDITION_FAILED -- the pin changed AGAIN
   *  case) deliberately do NOT use this; they dispatch
   *  ``reauth-result`` with ``{outcome: "pin_changed"}`` and
   *  close the wizard so the operator restarts from the alert
   *  and re-OOBs the fresh pin. Retryable failures stay on
   *  step 3 so the existing verification still binds across
   *  the retry. */
  @state() private _errorKey: string | null = null;

  open(alert: OffloaderPinMismatchAlert): void {
    this._alert = alert;
    this._step = 1;
    this._verified = false;
    this._busy = false;
    this._errorKey = null;
    this._open = true;
  }

  close(): void {
    this._open = false;
  }

  private _onClose = () => {
    this._open = false;
  };

  private _onBack = () => {
    if (this._step > 1) this._step = (this._step - 1) as Step;
  };

  private _onContinue = () => {
    if (this._step < 3) this._step = (this._step + 1) as Step;
  };

  private _onVerifiedChange = (e: Event) => {
    this._verified = (e.target as HTMLInputElement).checked;
  };

  private _onConfirm = async (): Promise<void> => {
    if (!this._verified || this._alert === null || this._api === undefined) {
      return;
    }
    if (this._busy) return;
    const alert = this._alert;
    // Thread the wizard's observed_pin (the operator just
    // verified it OOB at step 1) straight into request_pair.
    // The backend's TOCTOU defense compares this pin to the
    // pubkey observed on its own live handshake at request_pair
    // time and rejects with PRECONDITION_FAILED on mismatch.
    // That binds the user's wizard verification to the
    // eventual pinned identity: an attacker that took over
    // the hostname after step 1 (mDNS spoof, DHCP-lease
    // takeover) cannot get its pubkey persisted because its
    // handshake produces a different pubkey than observed_pin.
    //
    // The pin_sha256 in the request_pair args is the
    // load-bearing security contract: it MUST be
    // alert.observed_pin (the value the operator OOB-verified
    // at step 1). See helpers/buildReauthPairRequest. The
    // backend's TOCTOU defense at controller.py:3055-3062
    // compares its live handshake's pubkey to that value and
    // rejects on mismatch -- which is how the wizard's
    // verification cryptographically binds to the eventual
    // stored pairing.
    const args = buildReauthPairRequest(
      alert,
      friendlyHostname(window.location.hostname)
    );
    this._busy = true;
    this._errorKey = null;
    let summary: PairingSummary;
    try {
      try {
        summary = await this._api.requestRemoteBuildPair(args);
      } catch (err) {
        const outcome = classifyReauthError(err);
        if (outcome.kind === "terminal_pin_changed") {
          // Operator's step-1 verification is stale; force a
          // restart from the alert so they re-OOB against a
          // fresh observation. Retrying inline would silently
          // rebind verification to a pin they never saw.
          this._dispatchResult("pin_changed", alert.receiver_label);
          this._open = false;
          return;
        }
        // Retryable: keep step 3 open so the existing
        // verification still binds across the retry. The
        // inline error block + 'Try again' CTA fire from
        // this state.
        this._errorKey = outcome.errorKey;
        return;
      }
    } finally {
      // Single _busy clear-down so a future code path added
      // to either branch can't accidentally leave the action
      // buttons disabled. Each return path above resets
      // wizard state appropriately before this finally runs.
      this._busy = false;
    }
    // Mirror the fresh-pair dialog: dispatch
    // ``pair-request-sent`` with the returned
    // ``PairingSummary`` so app-shell's
    // ``_onPairRequestSent`` upserts the row into
    // ``buildOffloadPairings``. The backend persists the
    // updated ``StoredPairing`` (new ``pin_sha256``,
    // ``static_x25519_pub``, etc.) but does NOT fire
    // ``OFFLOADER_PAIR_STATUS_CHANGED`` for a re-pair against
    // an APPROVED row whose pin rotated under it -- the
    // status didn't change, only the cryptographic identity
    // did. Without this dispatch the local pairings map
    // keeps the stale-pin entry until a full
    // ``subscribe_events`` re-snapshot, and the background
    // peer-link client keeps reconnecting against the old
    // pin -> pin_mismatch alert fires again -> wizard
    // re-opens in a loop until reload. Mirrors the
    // bubble+composed dispatch the pair dialog uses so the
    // same upsert listeners (build-offload-section.ts and
    // app-shell.ts) catch it.
    this.dispatchEvent(
      new CustomEvent<{ summary: PairingSummary }>("pair-request-sent", {
        detail: { summary },
        bubbles: true,
        composed: true,
      })
    );
    this._dispatchResult("success", alert.receiver_label);
    this._open = false;
  };

  private _dispatchResult(
    outcome: "success" | "pin_changed",
    receiverLabel: string
  ): void {
    this.dispatchEvent(
      new CustomEvent("reauth-result", {
        bubbles: true,
        composed: true,
        detail: { outcome, receiver_label: receiverLabel },
      })
    );
  }

  private _renderStep1(alert: OffloaderPinMismatchAlert) {
    const target = `${trimTrailingDot(alert.receiver_hostname)}:${alert.receiver_port}`;
    return html`
      <p class="lede">
        ${this._localize("settings.reauth_wizard_step1_body", {
          label: alert.receiver_label,
          target,
        })}
      </p>
      <div class="pin-pair">
        <div class="pin-block">
          <div class="pin-block-label">
            ${this._localize("settings.reauth_wizard_expected_label")}
          </div>
          <esphome-pin-emoji-grid .pin=${alert.expected_pin}></esphome-pin-emoji-grid>
          <details class="pin-hex">
            <summary>${this._localize("settings.remote_build_pin_hex_summary")}</summary>
            <code>${formatPinSha256(alert.expected_pin)}</code>
          </details>
        </div>
        <div class="pin-block">
          <div class="pin-block-label pin-block-label-observed">
            ${this._localize("settings.reauth_wizard_observed_label")}
          </div>
          <esphome-pin-emoji-grid .pin=${alert.observed_pin}></esphome-pin-emoji-grid>
          <details class="pin-hex">
            <summary>${this._localize("settings.remote_build_pin_hex_summary")}</summary>
            <code>${formatPinSha256(alert.observed_pin)}</code>
          </details>
        </div>
      </div>
    `;
  }

  private _renderStep2() {
    return html`
      <p class="lede">${this._localize("settings.reauth_wizard_step2_lede")}</p>
      <div class="possibilities">
        <div class="possibility possibility-benign">
          <div class="possibility-title">
            ${this._localize("settings.reauth_wizard_step2_benign_title")}
          </div>
          <div class="possibility-body">
            ${this._localize("settings.reauth_wizard_step2_benign_body")}
          </div>
        </div>
        <div class="possibility possibility-malign">
          <div class="possibility-title">
            ${this._localize("settings.reauth_wizard_step2_malign_title")}
          </div>
          <div class="possibility-body">
            ${this._localize("settings.reauth_wizard_step2_malign_body")}
          </div>
        </div>
      </div>
    `;
  }

  private _renderStep3(alert: OffloaderPinMismatchAlert) {
    return html`
      <p class="lede">
        ${this._localize("settings.reauth_wizard_step3_lede", {
          label: alert.receiver_label,
        })}
      </p>
      <div class="pin-block pin-block-solo">
        <div class="pin-block-label pin-block-label-observed">
          ${this._localize("settings.reauth_wizard_observed_label")}
        </div>
        <esphome-pin-emoji-grid .pin=${alert.observed_pin}></esphome-pin-emoji-grid>
        <details class="pin-hex">
          <summary>${this._localize("settings.remote_build_pin_hex_summary")}</summary>
          <code>${formatPinSha256(alert.observed_pin)}</code>
        </details>
      </div>
      <label class="verify-row">
        <input
          type="checkbox"
          .checked=${this._verified}
          @change=${this._onVerifiedChange}
          ?disabled=${this._busy}
        />
        <span> ${this._localize("settings.reauth_wizard_verified_checkbox")} </span>
      </label>
      ${this._errorKey !== null
        ? html`
            <div class="step-error" role="alert">
              ${this._localize(this._errorKey, {
                label: alert.receiver_label,
              })}
            </div>
          `
        : nothing}
    `;
  }

  protected render() {
    if (!this._open || this._alert === null) return nothing;
    const alert = this._alert;
    const stepBody =
      this._step === 1
        ? this._renderStep1(alert)
        : this._step === 2
          ? this._renderStep2()
          : this._renderStep3(alert);
    const title = this._localize(`settings.reauth_wizard_step${this._step}_title`);
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        ?busy=${this._busy}
        .label=${title}
        @after-hide=${this._onClose}
      >
        <div
          class="step-indicator"
          aria-label=${this._localize("settings.reauth_wizard_step_progress", {
            step: this._step,
            total: 3,
          })}
        >
          ${[1, 2, 3].map(
            (n) => html`
              <span
                class=${`dot ${this._step === n ? "dot-active" : ""}`}
                aria-hidden="true"
              ></span>
            `
          )}
        </div>
        <div class="step-body">${stepBody}</div>
        <div class="actions">
          <button
            class="btn btn--cancel"
            type="button"
            @click=${this._onClose}
            ?disabled=${this._busy}
          >
            ${this._localize("layout.cancel")}
          </button>
          ${this._step > 1
            ? html`<button
                class="btn btn--back"
                type="button"
                @click=${this._onBack}
                ?disabled=${this._busy}
              >
                ${this._localize("settings.reauth_wizard_back")}
              </button>`
            : nothing}
          ${this._step < 3
            ? html`<button
                class="btn btn--primary"
                type="button"
                @click=${this._onContinue}
              >
                ${this._localize("settings.reauth_wizard_continue")}
              </button>`
            : html`<button
                class="btn btn--primary"
                type="button"
                ?disabled=${!this._verified || this._busy}
                @click=${this._onConfirm}
              >
                ${this._busy
                  ? this._localize("settings.reauth_wizard_repair_in_progress")
                  : this._errorKey !== null
                    ? this._localize("settings.reauth_wizard_repair_retry")
                    : this._localize("settings.reauth_wizard_repair_action")}
              </button>`}
        </div>
      </esphome-base-dialog>
    `;
  }

  static styles = [
    espHomeStyles,
    pinHexStyles,
    dialogActionButtonStyles,
    reauthWizardDialogStyles,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-reauth-wizard-dialog": ESPHomeReauthWizardDialog;
  }
}
