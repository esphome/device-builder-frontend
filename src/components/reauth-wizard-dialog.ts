import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import { APIError } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import {
  ErrorCode,
  type OffloaderPinMismatchAlert,
  type PairingSummary,
} from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { dialogActionButtonStyles } from "../styles/dialog-action-buttons.js";
import { pinHexStyles } from "../styles/pin-hex.js";
import { espHomeStyles } from "../styles/shared.js";
import { friendlyHostname, trimTrailingDot } from "../util/hostname.js";
import { formatPinSha256 } from "../util/pin-format.js";

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
 * Pressing **Re-pair this receiver** on step 3 fires
 * 'reauth-confirmed' carrying the alert's
 * '{hostname, port, observed_pin, receiver_label}'. The
 * dialog itself doesn't open another OOB surface -- the
 * observed_pin the operator just verified at step 1 is the
 * authoritative gate, and the parent handler threads it
 * straight into 'request_pair' so the backend's TOCTOU
 * defense binds the cryptographic identity the user
 * confirmed in this wizard to the eventual stored pairing.
 *
 * Pre-rewrite the wizard opened a separate
 * '<esphome-pair-build-server-dialog>' that re-ran
 * preview_pair against {hostname, port} -- producing a
 * SECOND observation of the receiver's pubkey, with an
 * unbounded TOCTOU window between the wizard's step-1
 * display and the pair dialog's confirm step. mDNS / DHCP
 * lease changes during that window could rebind the
 * hostname to a different host, and the user would
 * cryptographically pin whatever the pair dialog observed
 * (potentially an attacker) while believing they had
 * verified the legitimate-rotation pin. Carrying observed_pin
 * through the event and skipping the pair dialog closes
 * that window: the user's wizard verification IS the
 * verification, and the backend's existing pin-arg TOCTOU
 * check at request_pair rejects any subsequent rebind.
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
   *  case) deliberately do NOT use this; they close the
   *  wizard via the ``reauth-pin-changed`` event so the
   *  operator restarts from the alert and re-OOBs the fresh
   *  pin. Retryable failures stay on step 3 so the existing
   *  verification still binds across the retry. */
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
    // offloader_label mirrors the fresh-pair dialog's
    // pre-fill -- friendlyHostname(window.location.hostname)
    // -- so the receiver-side StoredPeer row stays consistent
    // with what the original pair recorded.
    const offloaderLabel = friendlyHostname(window.location.hostname);
    this._busy = true;
    this._errorKey = null;
    let summary: PairingSummary;
    try {
      summary = await this._api.requestRemoteBuildPair({
        hostname: alert.receiver_hostname,
        port: alert.receiver_port,
        pin_sha256: alert.observed_pin,
        receiver_label: alert.receiver_label,
        offloader_label: offloaderLabel,
      });
    } catch (err) {
      // PRECONDITION_FAILED is the load-bearing case: the
      // receiver's pubkey differs from observed_pin RIGHT NOW.
      // The operator's step-1 verification is stale, so
      // forcing them back to the alert (which re-fires
      // preview_pair and resurfaces this wizard with the new
      // observed pin) is correct -- letting them retry from
      // inside the wizard would silently re-use the now-stale
      // pin and either keep failing or, worse, succeed against
      // an attacker that the operator hasn't OOB-confirmed.
      if (err instanceof APIError && err.errorCode === ErrorCode.PRECONDITION_FAILED) {
        this._busy = false;
        this._dispatchResult("pin_changed", alert.receiver_label);
        this._open = false;
        return;
      }
      // Retryable failures (NO_PAIRING_WINDOW / UNAVAILABLE /
      // anything else that isn't a stale-pin error): keep the
      // wizard open on step 3 so the operator's verification
      // still binds across the retry. The inline error block
      // renders below the verified checkbox with a "Try again"
      // button that re-fires this same handler.
      this._busy = false;
      this._errorKey = this._errorKeyFor(err);
      return;
    }
    this._busy = false;
    // Mirror the fresh-pair dialog: dispatch ``pair-request-sent``
    // with the returned ``PairingSummary`` so app-shell's
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
      }),
    );
    this._dispatchResult("success", alert.receiver_label);
    this._open = false;
  };

  private _errorKeyFor(err: unknown): string {
    if (err instanceof APIError) {
      if (err.errorCode === ErrorCode.NO_PAIRING_WINDOW) {
        return "settings.reauth_repair_no_window";
      }
      if (err.errorCode === ErrorCode.UNAVAILABLE) {
        return "settings.reauth_repair_unreachable";
      }
    }
    return "settings.reauth_repair_failed";
  }

  private _dispatchResult(
    outcome: "success" | "pin_changed",
    receiverLabel: string,
  ): void {
    this.dispatchEvent(
      new CustomEvent("reauth-result", {
        bubbles: true,
        composed: true,
        detail: { outcome, receiver_label: receiverLabel },
      }),
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
          <esphome-pin-emoji-grid
            .pin=${alert.expected_pin}
          ></esphome-pin-emoji-grid>
          <details class="pin-hex">
            <summary>
              ${this._localize("settings.remote_build_pin_hex_summary")}
            </summary>
            <code>${formatPinSha256(alert.expected_pin)}</code>
          </details>
        </div>
        <div class="pin-block">
          <div class="pin-block-label pin-block-label-observed">
            ${this._localize("settings.reauth_wizard_observed_label")}
          </div>
          <esphome-pin-emoji-grid
            .pin=${alert.observed_pin}
          ></esphome-pin-emoji-grid>
          <details class="pin-hex">
            <summary>
              ${this._localize("settings.remote_build_pin_hex_summary")}
            </summary>
            <code>${formatPinSha256(alert.observed_pin)}</code>
          </details>
        </div>
      </div>
    `;
  }

  private _renderStep2() {
    return html`
      <p class="lede">
        ${this._localize("settings.reauth_wizard_step2_lede")}
      </p>
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
        <esphome-pin-emoji-grid
          .pin=${alert.observed_pin}
        ></esphome-pin-emoji-grid>
        <details class="pin-hex">
          <summary>
            ${this._localize("settings.remote_build_pin_hex_summary")}
          </summary>
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
        <span>
          ${this._localize("settings.reauth_wizard_verified_checkbox")}
        </span>
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
        .label=${title}
        @after-hide=${this._onClose}
      >
        <div
          class="step-indicator"
          aria-label=${this._localize(
            "settings.reauth_wizard_step_progress",
            { step: this._step, total: 3 },
          )}
        >
          ${[1, 2, 3].map(
            (n) => html`
              <span
                class=${`dot ${this._step === n ? "dot-active" : ""}`}
                aria-hidden="true"
              ></span>
            `,
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
            ? html`<button class="btn btn--primary" type="button" @click=${this._onContinue}>
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
    css`
      esphome-base-dialog {
        --width: 560px;
      }

      /* Step-progress dots sit at the top of the body. The
         pre-migration shape rendered them inside the
         slot=label header next to the wizard title;
         base-dialog's .label property only takes a string,
         so the indicator moved into the body where it reads
         as the first row above the step content. Wizard
         title still renders in the dialog header via the
         .label property. */
      .step-indicator {
        display: flex;
        gap: 6px;
        align-items: center;
        padding-bottom: var(--wa-space-s);
      }

      .dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--wa-color-surface-border);
      }

      .dot-active {
        background: var(--esphome-primary);
      }

      .step-body {
        padding: var(--wa-space-s) 0;
      }

      .lede {
        margin: 0 0 var(--wa-space-m);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-normal);
      }

      .pin-pair {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--wa-space-m);
      }

      .pin-block {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
        padding: var(--wa-space-s) var(--wa-space-m);
        background: var(--wa-color-surface-lowered);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
      }

      .pin-block-solo {
        max-width: 320px;
      }

      .pin-block-label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--wa-color-text-quiet);
      }

      .pin-block-label-observed {
        color: var(--esphome-warning, #f59e0b);
      }

      .possibilities {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--wa-space-m);
      }

      .possibility {
        padding: var(--wa-space-s) var(--wa-space-m);
        border-radius: var(--wa-border-radius-m);
        border-left: 3px solid;
      }

      .possibility-benign {
        background: color-mix(in srgb, var(--esphome-success), transparent 92%);
        border-left-color: var(--esphome-success);
      }

      .possibility-malign {
        background: color-mix(in srgb, var(--esphome-error), transparent 92%);
        border-left-color: var(--esphome-error);
      }

      .possibility-title {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        margin-bottom: var(--wa-space-2xs);
      }

      .possibility-body {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-normal);
      }

      .verify-row {
        display: flex;
        align-items: flex-start;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-m);
        padding: var(--wa-space-s) var(--wa-space-m);
        background: color-mix(
          in srgb,
          var(--esphome-warning, #f59e0b),
          transparent 92%
        );
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        cursor: pointer;
      }

      .verify-row input {
        margin-top: 2px;
      }

      /* Step-3 inline error block. Renders when request_pair
         returned a retryable failure (NO_PAIRING_WINDOW /
         UNAVAILABLE / generic). The wizard keeps step 3 open
         so the operator's verification still binds across
         the retry -- the primary action button below
         retitles to 'Try again' (or 'Re-pairing...' while
         busy). Uses the warning palette like .verify-row but
         a touch louder. */
      .step-error {
        margin-top: var(--wa-space-m);
        padding: var(--wa-space-s) var(--wa-space-m);
        border-left: 3px solid var(--wa-color-warning-fill-loud);
        background: color-mix(
          in srgb,
          var(--wa-color-warning-fill-loud),
          transparent 88%
        );
        border-radius: var(--wa-border-radius-s);
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-normal);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        margin-top: var(--wa-space-m);
      }

      /* Back is .btn--cancel's neutral chrome with a distinct
         class name so the markup self-documents which row slot
         the button is. dialogActionButtonStyles paints
         .btn--cancel; this rule extends the same chrome to
         .btn--back without re-declaring it. */
      .btn--back {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .btn--back:hover:not(:disabled) {
        background: var(--wa-color-surface-border);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-reauth-wizard-dialog": ESPHomeReauthWizardDialog;
  }
}
