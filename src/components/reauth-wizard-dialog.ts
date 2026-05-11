import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import type { OffloaderPinMismatchAlert } from "../api/types.js";
import { dialogActionButtonStyles } from "../styles/dialog-action-buttons.js";
import { pinHexStyles } from "../styles/pin-hex.js";
import { espHomeStyles } from "../styles/shared.js";
import { formatPinSha256 } from "../util/cert-pin-format.js";
import { trimTrailingDot } from "../util/hostname.js";

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
 * admin rotated the identity legitimately (cert rotation, OS
 * reinstall, server rebuild), or something is impersonating
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
 * ``reauth-confirmed`` with ``{hostname, port}``. The dialog
 * itself doesn't run ``preview_pair`` / ``request_pair`` — the
 * existing ``<esphome-pair-build-server-dialog>`` already
 * does both, and re-doing them here would mean two
 * preview_pair round-trips back-to-back with a TOCTOU window
 * between. Settings-dialog catches the event and opens the
 * existing pair wizard pre-filled with the alert's hostname
 * + port; that dialog's confirm step is the canonical OOB
 * surface and stays the load-bearing verification gate.
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

  @state() private _open = false;
  @state() private _step: Step = 1;
  @state() private _alert: OffloaderPinMismatchAlert | null = null;
  /** Step-3 checkbox state: gates the Re-pair button so the
   *  operator can't bypass the "I've checked with the receiver
   *  admin" acknowledgment. Resets on every ``open()``. */
  @state() private _verified = false;

  open(alert: OffloaderPinMismatchAlert): void {
    this._alert = alert;
    this._step = 1;
    this._verified = false;
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

  private _onConfirm = () => {
    if (!this._verified || this._alert === null) return;
    const alert = this._alert;
    this.dispatchEvent(
      new CustomEvent("reauth-confirmed", {
        bubbles: true,
        composed: true,
        detail: {
          hostname: alert.receiver_hostname,
          port: alert.receiver_port,
        },
      }),
    );
    this._open = false;
  };

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
        />
        <span>
          ${this._localize("settings.reauth_wizard_verified_checkbox")}
        </span>
      </label>
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
          <button class="btn btn--cancel" type="button" @click=${this._onClose}>
            ${this._localize("layout.cancel")}
          </button>
          ${this._step > 1
            ? html`<button class="btn btn--back" type="button" @click=${this._onBack}>
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
                ?disabled=${!this._verified}
                @click=${this._onConfirm}
              >
                ${this._localize("settings.reauth_wizard_repair_action")}
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
