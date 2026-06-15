import { consume } from "@lit/context";
import { mdiWifi } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { dialogActionButtonStyles } from "../styles/dialog-action-buttons.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { EnterController } from "../util/enter-controller.js";
import { formatApiError } from "../util/format-api-error.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { wifiFieldsStyles } from "./onboarding/wifi-fields-styles.js";
import { isWifiPasswordTooShort, renderWifiFields } from "./onboarding/wifi-fields.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./base-dialog.js";

registerMdiIcons({ wifi: mdiWifi });

/**
 * First-run Wi-Fi setup dialog.
 *
 * Surfaced by the app shell when ``OnboardingState.completed_version
 * < current_version``. The dialog gives the user three exits:
 *
 * - **Save** — POSTs the new credentials to
 *   ``onboarding/set_wifi_credentials`` and acknowledges the
 *   current version. Closes.
 * - **Maybe later** (close button) — frontend-only session
 *   dismiss. The dialog reopens on the next dashboard load.
 * - **I only use Ethernet** — explicit decline. POSTs
 *   ``onboarding/mark_acknowledged`` so the dialog stops
 *   re-opening for this user, but the secrets-menu badge stays
 *   (the underlying data is still un-configured) so a user who
 *   later switches to Wi-Fi has a visible reminder.
 *
 * The dialog is dispatched a ``onboarding-acknowledged`` event on
 * a successful save / decline so the app shell can refresh its
 * cached state without re-querying.
 */
@customElement("esphome-onboarding-wifi-dialog")
export class ESPHomeOnboardingWifiDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state()
  private _ssid = "";

  @state()
  private _password = "";

  @state()
  private _saving = false;

  @state()
  private _error: string | null = null;

  @state()
  private _open = false;

  @query("#onboarding-ssid")
  private _ssidInput?: HTMLInputElement;

  private get _passwordTooShort(): boolean {
    return isWifiPasswordTooShort(this._password);
  }

  /** True after the user has explicitly saved or declined inside
   *  the current open() — suppresses the close-via-X session-
   *  dismiss path so we don't both ``mark_acknowledged`` AND fire
   *  ``onboarding-dismissed-session`` for the same close. */
  private _exitedExplicitly = false;

  // Enter submits; _save() self-guards on a blank SSID / too-short password.
  private _enter = new EnterController(this, () => this._save());

  open() {
    this._ssid = "";
    this._password = "";
    this._saving = false;
    this._error = null;
    this._exitedExplicitly = false;
    this._open = true;
    this._enter.set(true);
    // autofocus is unreliable for a shadow-DOM input shown after first paint.
    void this.updateComplete.then(() => this._ssidInput?.focus());
  }

  close() {
    this._open = false;
  }

  static styles = [
    espHomeStyles,
    inputStyles,
    dialogActionButtonStyles,
    wifiFieldsStyles,
    css`
      esphome-base-dialog {
        --width: 480px;
      }

      .body {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
      }

      .intro {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
        margin: 0;
      }

      .intro wa-icon {
        font-size: 18px;
        vertical-align: -3px;
        margin-right: var(--wa-space-2xs);
        color: var(--esphome-primary);
      }

      /* Decline-permanent is rendered as a low-emphasis text link
         under the body fields rather than a third button in the
         footer — a button on the same row as Save / Maybe later
         drew the eye away from the primary action and looked
         visually heavier than its real weight. The link styling
         keeps it accessible and discoverable without competing
         with the buttons. */
      .opt-out {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        text-align: center;
        margin: 0;
      }

      .opt-out button {
        background: none;
        border: none;
        padding: 0;
        font-family: inherit;
        font-size: inherit;
        color: var(--esphome-primary);
        cursor: pointer;
        text-decoration: underline;
      }

      .opt-out button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .actions {
        display: flex;
        flex-direction: row;
        justify-content: flex-end;
        align-items: center;
        gap: var(--wa-space-s);
      }
    `,
  ];

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        ?busy=${this._saving}
        .label=${this._localize("onboarding.wifi.title")}
        @request-close=${this._onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        <div class="body">
          <p class="intro">
            <wa-icon library="mdi" name="wifi"></wa-icon>
            ${this._localize("onboarding.wifi.intro")}
          </p>
          ${renderWifiFields({
            localize: this._localize,
            ssid: this._ssid,
            password: this._password,
            disabled: this._saving,
            onSsidInput: (v) => {
              this._ssid = v;
            },
            onPasswordInput: (v) => {
              this._password = v;
            },
          })}
          ${this._error
            ? html`<p class="error" role="alert">${this._error}</p>`
            : nothing}
          <p class="opt-out">
            <button
              type="button"
              ?disabled=${this._saving}
              @click=${this._declinePermanently}
            >
              ${this._localize("onboarding.wifi.decline_permanent")}
            </button>
          </p>
        </div>
        <div slot="footer" class="actions">
          <button
            type="button"
            class="btn btn--cancel"
            ?disabled=${this._saving}
            @click=${this._dismissForSession}
          >
            ${this._localize("onboarding.wifi.dismiss_session")}
          </button>
          <button
            type="button"
            class="btn btn--primary"
            ?disabled=${this._saving || !this._ssid.trim() || this._passwordTooShort}
            @click=${this._save}
          >
            ${this._saving
              ? this._localize("onboarding.wifi.saving")
              : this._localize("onboarding.wifi.save")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  private async _save() {
    // The Enter path bypasses the disabled Save button, so guard re-entry
    // here too or a held Enter double-submits during the await below.
    if (this._saving) return;
    // IEEE 802.11 SSIDs may legally contain leading/trailing
    // whitespace, so don't ``trim()`` the value being sent —
    // mutating it would silently change the network name and
    // the device would fail to associate. The Save button is
    // already disabled on all-whitespace input via the same
    // check below.
    if (!this._ssid.trim() || this._passwordTooShort) return;
    this._saving = true;
    this._error = null;
    try {
      await this._api.setOnboardingWifi(this._ssid, this._password);
    } catch (err) {
      // The wifi write itself failed — the user's credentials
      // never landed on disk. Surface the error inline so they
      // can correct and retry.
      this._error = formatApiError(err, this._localize, "onboarding.wifi.save_failed");
      this._saving = false;
      return;
    }
    // Notify any mounted secrets-editor instance (and app-shell's
    // onboarding-state refresh) that secrets.yaml has changed on
    // disk. Window-level so listeners can live anywhere in the
    // tree; ``detail.source`` lets a future self-listener short-
    // circuit. Fired before ``markOnboardingAcknowledged`` so a
    // failure on the second call doesn't suppress the refresh
    // — the wifi write is the user-visible state change.
    window.dispatchEvent(new CustomEvent("secrets-saved", { detail: { source: this } }));
    try {
      // Acknowledge so the dialog doesn't re-pop on next load even
      // if the badge logic wants to keep the menu indicator.
      await this._api.markOnboardingAcknowledged();
    } catch (err) {
      // Wifi WAS saved — the only consequence of a failed ack is
      // that the wizard will re-pop on next load. Don't gate the
      // success path on it: log + show a non-blocking warning
      // toast, then close as if everything succeeded. Inline
      // errors at this point would be misleading ("Couldn't save
      // Wi-Fi credentials" while the credentials are now safely
      // on disk).
      console.warn("Failed to mark onboarding acknowledged:", err);
      toast.warning(this._localize("onboarding.wifi.ack_failed"));
    }
    toast.success(this._localize("onboarding.wifi.save_success"));
    this._exitedExplicitly = true;
    this._emitAcknowledged();
    this.close();
    this._saving = false;
  }

  private async _declinePermanently() {
    this._saving = true;
    this._error = null;
    try {
      await this._api.markOnboardingAcknowledged();
      this._exitedExplicitly = true;
      this._emitAcknowledged();
      this.close();
    } catch (err) {
      // Decline never writes secrets — only the ack call
      // happened. Use the decline-specific fallback so the user
      // doesn't see "Couldn't save Wi-Fi credentials" when
      // nothing of theirs was being saved in the first place.
      this._error = formatApiError(err, this._localize, "onboarding.wifi.decline_failed");
    } finally {
      this._saving = false;
    }
  }

  /**
   * Catch-all for any close that wasn't initiated via Save / Decline /
   * the explicit "Maybe later" button — e.g. the dialog's built-in
   * X, Escape, or a backdrop click. Treat it as a session dismiss
   * so the badge stays accurate but the dialog doesn't re-open
   * mid-session.
   */
  private _onAfterHide() {
    this._enter.set(false);
    if (!this._exitedExplicitly) {
      this._dismissForSession();
    }
  }

  /**
   * Flip the reactive flag on the initiating close so a re-render
   * can't re-assert ?open mid-hide; teardown stays in after-hide.
   * The save / decline veto is handled by esphome-base-dialog's busy
   * gate (``?busy=${this._saving}``): while saving it absorbs the
   * X / Escape / backdrop-click and never emits request-close, so
   * this handler only runs once the round-trip has resolved — the
   * dialog can't hide before the user sees an inline save error.
   */
  private _onRequestClose = (): void => {
    this._open = false;
  };

  private _dismissForSession = () => {
    // Idempotent — wa-after-hide also routes here, and an explicit
    // "Maybe later" tap fires this directly *and* synthesises an
    // after-hide. Setting ``_exitedExplicitly`` first short-
    // circuits the second pass through the after-hide handler.
    this._exitedExplicitly = true;
    this.dispatchEvent(
      new CustomEvent("onboarding-dismissed-session", {
        bubbles: true,
        composed: true,
      })
    );
    this.close();
  };

  private _emitAcknowledged() {
    this.dispatchEvent(
      new CustomEvent("onboarding-acknowledged", {
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-onboarding-wifi-dialog": ESPHomeOnboardingWifiDialog;
  }
}
