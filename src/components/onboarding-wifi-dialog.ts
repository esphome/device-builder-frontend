import { consume } from "@lit/context";
import { mdiWifi } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import toast from "sonner-js";
import { APIError } from "../api/index.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { type PasswordInputValueChange } from "./device/password-input-event.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/input/input.js";
import "./device/password-input.js";

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

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  /** True after the user has explicitly saved or declined inside
   *  the current open() — suppresses the close-via-X session-
   *  dismiss path so we don't both ``mark_acknowledged`` AND fire
   *  ``onboarding-dismissed-session`` for the same close. */
  private _exitedExplicitly = false;

  open() {
    this._ssid = "";
    this._password = "";
    this._saving = false;
    this._error = null;
    this._exitedExplicitly = false;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
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

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
      }

      label {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-s);
      }

      .actions {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        align-items: center;
        gap: var(--wa-space-s);
        flex-wrap: wrap;
      }

      .actions-secondary {
        display: flex;
        gap: var(--wa-space-s);
      }
    `,
  ];

  protected render() {
    return html`
      <wa-dialog
        label=${this._localize("onboarding.wifi.title")}
        @wa-after-hide=${this._onAfterHide}
      >
        <div class="body">
          <p class="intro">
            <wa-icon library="mdi" name="wifi"></wa-icon>
            ${this._localize("onboarding.wifi.intro")}
          </p>
          <div class="field">
            <label for="onboarding-ssid">${this._localize("onboarding.wifi.ssid_label")}</label>
            <wa-input
              id="onboarding-ssid"
              .value=${this._ssid}
              maxlength="32"
              placeholder=${this._localize("onboarding.wifi.ssid_placeholder")}
              ?disabled=${this._saving}
              @input=${(e: Event) => {
                this._ssid = (e.target as HTMLInputElement).value;
              }}
            ></wa-input>
          </div>
          <div class="field">
            <label for="onboarding-password">${this._localize("onboarding.wifi.password_label")}</label>
            <esphome-password-input
              id="onboarding-password"
              .value=${this._password}
              .placeholder=${this._localize("onboarding.wifi.password_placeholder")}
              ?disabled=${this._saving}
              @password-input-change=${(
                e: CustomEvent<PasswordInputValueChange>,
              ) => {
                this._password = e.detail.value;
              }}
            ></esphome-password-input>
          </div>
          ${this._error
            ? html`<p class="error" role="alert">${this._error}</p>`
            : nothing}
        </div>
        <div slot="footer" class="actions">
          <wa-button
            appearance="plain"
            ?disabled=${this._saving}
            @click=${this._declinePermanently}
          >
            ${this._localize("onboarding.wifi.decline_permanent")}
          </wa-button>
          <div class="actions-secondary">
            <wa-button
              appearance="plain"
              ?disabled=${this._saving}
              @click=${this._dismissForSession}
            >
              ${this._localize("onboarding.wifi.dismiss_session")}
            </wa-button>
            <wa-button
              variant="brand"
              ?disabled=${this._saving || !this._ssid.trim()}
              @click=${this._save}
            >
              ${this._saving
                ? this._localize("onboarding.wifi.saving")
                : this._localize("onboarding.wifi.save")}
            </wa-button>
          </div>
        </div>
      </wa-dialog>
    `;
  }

  private async _save() {
    const ssid = this._ssid.trim();
    if (!ssid) return;
    this._saving = true;
    this._error = null;
    try {
      await this._api.setOnboardingWifi(ssid, this._password);
      // Acknowledge so the dialog doesn't re-pop on next load even
      // if the badge logic wants to keep the menu indicator.
      await this._api.markOnboardingAcknowledged();
      toast.success(this._localize("onboarding.wifi.save_success"));
      this._exitedExplicitly = true;
      this._emitAcknowledged();
      this.close();
    } catch (err) {
      this._error = this._formatError(err);
    } finally {
      this._saving = false;
    }
  }

  private async _declinePermanently() {
    this._saving = true;
    try {
      await this._api.markOnboardingAcknowledged();
      this._exitedExplicitly = true;
      this._emitAcknowledged();
      this.close();
    } catch (err) {
      this._error = this._formatError(err);
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
    if (!this._exitedExplicitly) {
      this._dismissForSession();
    }
  }

  /**
   * Surface a backend error in user-facing prose. ``APIError``
   * carries a structured ``errorCode`` + ``details`` pair; its
   * ``Error.message`` is the wire form ``"INVALID_ARGS: …"`` —
   * fine for logs, leaks an internal code into the dialog's
   * inline error if rendered raw. Show ``details`` directly when
   * we have an ``APIError``, fall back to ``message`` for native
   * errors, and fall back to the localized generic when we have
   * neither.
   */
  private _formatError(err: unknown): string {
    if (err instanceof APIError) {
      return err.details || this._localize("onboarding.wifi.save_failed");
    }
    if (err instanceof Error) return err.message;
    return this._localize("onboarding.wifi.save_failed");
  }

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
      }),
    );
    this.close();
  };

  private _emitAcknowledged() {
    this.dispatchEvent(
      new CustomEvent("onboarding-acknowledged", {
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-onboarding-wifi-dialog": ESPHomeOnboardingWifiDialog;
  }
}
