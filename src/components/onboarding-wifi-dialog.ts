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
 * Wi-Fi credentials dialog — the kebab "Set up / Change Wi-Fi credentials"
 * action. Manual, on-demand only (never auto-popped; the create wizard collects
 * Wi-Fi per device). Saves the shared ``wifi_ssid`` / ``wifi_password`` to
 * ``secrets.yaml`` via ``config/set_wifi_credentials`` and dispatches
 * ``secrets-saved`` so secret pickers and the kebab wording refresh. Plain
 * Save / Cancel — no onboarding decline / acknowledgement.
 */
@customElement("esphome-onboarding-wifi-dialog")
export class ESPHomeOnboardingWifiDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state() private _ssid = "";
  @state() private _password = "";
  @state() private _saving = false;
  @state() private _error: string | null = null;
  @state() private _open = false;

  @query("#onboarding-ssid")
  private _ssidInput?: HTMLInputElement;

  private get _passwordTooShort(): boolean {
    return isWifiPasswordTooShort(this._password);
  }

  // Enter submits; _save() self-guards on a blank SSID / too-short password.
  private _enter = new EnterController(this, () => this._save());

  open() {
    this._ssid = "";
    this._password = "";
    this._saving = false;
    this._error = null;
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
        @after-hide=${() => this._enter.set(false)}
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
        </div>
        <div slot="footer" class="actions">
          <button
            type="button"
            class="btn btn--cancel"
            ?disabled=${this._saving}
            @click=${() => this.close()}
          >
            ${this._localize("onboarding.wifi.cancel")}
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
    // The Enter path bypasses the disabled Save button, so guard re-entry here
    // too or a held Enter double-submits during the await below.
    if (this._saving) return;
    // IEEE 802.11 SSIDs may legally contain leading/trailing whitespace, so
    // don't trim the value being sent — mutating it would silently change the
    // network name. The Save button is disabled on all-whitespace input.
    if (!this._ssid.trim() || this._passwordTooShort) return;
    this._saving = true;
    this._error = null;
    try {
      await this._api.setWifiCredentials(this._ssid, this._password);
    } catch (err) {
      this._error = formatApiError(err, this._localize, "onboarding.wifi.save_failed");
      this._saving = false;
      return;
    }
    // Refresh any mounted secret pickers and the kebab "Set up / Change Wi-Fi"
    // wording now that secrets.yaml changed on disk.
    window.dispatchEvent(new CustomEvent("secrets-saved", { detail: { source: this } }));
    toast.success(this._localize("onboarding.wifi.save_success"));
    this.close();
    this._saving = false;
  }

  /**
   * Flip the reactive flag on the initiating close so a re-render can't
   * re-assert ?open mid-hide. While saving, esphome-base-dialog's busy gate
   * absorbs the X / Escape / backdrop click and never emits request-close, so
   * the dialog can't hide before the user sees an inline save error.
   */
  private _onRequestClose = (): void => {
    this._open = false;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-onboarding-wifi-dialog": ESPHomeOnboardingWifiDialog;
  }
}
