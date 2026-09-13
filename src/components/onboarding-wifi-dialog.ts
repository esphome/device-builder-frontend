import { consume } from "@lit/context";
import { mdiWifi } from "@mdi/js";
import { css, html, LitElement, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import toast from "sonner-js";
import { isApiErrorCode } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/index.js";
import { ErrorCode } from "../api/types/protocol.js";
import type { LocalizeFunc } from "../common/localize.js";
import {
  apiContext,
  localizeContext,
  onboardingPendingContext,
} from "../context/index.js";
import { dialogActionButtonStyles } from "../styles/dialog-action-buttons.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { DialogOpenController } from "../util/dialog-open-controller.js";
import { EnterController } from "../util/enter-controller.js";
import { formatApiError } from "../util/format-api-error.js";
import { registerMdiIcons } from "../util/register-icons.js";
import { SECRETS_FILE } from "../util/secret-eligibility.js";
import { inlineSecretValue } from "../util/secrets-entries.js";
import { wifiFieldsStyles } from "./onboarding/wifi-fields-styles.js";
import { isWifiPasswordTooShort, renderWifiFields } from "./onboarding/wifi-fields.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./base-dialog.js";

registerMdiIcons({ wifi: mdiWifi });

/**
 * Wi-Fi credentials dialog — the kebab "Set up / Change Wi-Fi credentials"
 * action. Manual, on-demand only (never auto-popped; the create wizard collects
 * Wi-Fi per device). Opens prefilled from the stored values and saves the
 * shared ``wifi_ssid`` / ``wifi_password`` to
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

  // Same signal as the kebab label, so the title says "Set up" or "Change" to match.
  @consume({ context: onboardingPendingContext, subscribe: true })
  @state()
  private _onboardingPending = false;

  @state() private _ssid = "";
  @state() private _password = "";
  @state() private _saving = false;
  // "failed" (read error, Retry) and "advanced" (a stored value the form can't
  // edit inline) both hold the form so Save can't overwrite the real secret.
  @state() private _loadState: "loading" | "ready" | "failed" | "advanced" = "ready";
  @state() private _error: string | null = null;
  private _storedPassword = "";
  // Bumped by every open, close and retry. An async load applies only while it
  // still matches, and the field elements are keyed on it so a reopen gets
  // fresh inputs (the password input's reveal toggle starts hidden again).
  private _generation = 0;

  private readonly _dialog = new DialogOpenController(this);

  @query("#onboarding-ssid")
  private _ssidInput?: HTMLInputElement;

  // A stored short password the user hasn't touched must not block an SSID-only edit.
  private get _passwordTooShort(): boolean {
    return (
      isWifiPasswordTooShort(this._password) && this._password !== this._storedPassword
    );
  }

  // Enter submits; _save() self-guards on a blank SSID / too-short password.
  private _enter = new EnterController(this, () => void this._save());

  open() {
    this._ssid = "";
    this._password = "";
    this._storedPassword = "";
    this._saving = false;
    this._error = null;
    this._dialog.open = true;
    this._enter.set(true);
    void this._loadAndFocus();
  }

  // The single teardown for every dismissal (Cancel, Save, Escape, X, outside-click):
  // synchronous, so nothing that fires later can act on a dismissed dialog.
  close() {
    this._generation++;
    this._enter.set(false);
    this._dialog.open = false;
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
        ?open=${this._dialog.open}
        ?busy=${this._saving}
        .label=${this._localize(
          this._onboardingPending
            ? "onboarding.wifi.title"
            : "onboarding.wifi.title_change"
        )}
        @request-close=${this.close}
      >
        <div class="body">
          <p class="intro">
            <wa-icon library="mdi" name="wifi"></wa-icon>
            ${this._localize("onboarding.wifi.intro")}
          </p>
          ${keyed(
            this._generation,
            renderWifiFields({
              localize: this._localize,
              ssid: this._ssid,
              password: this._password,
              disabled: this._saving || this._loadState !== "ready",
              tooShort: this._passwordTooShort,
              onSsidInput: (v) => {
                this._ssid = v;
              },
              onPasswordInput: (v) => {
                this._password = v;
              },
            })
          )}
          ${
            this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing
          }
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
          ${this._renderPrimaryAction()}
        </div>
      </esphome-base-dialog>
    `;
  }

  private _renderPrimaryAction() {
    if (this._loadState === "advanced") return nothing;
    const failed = this._loadState === "failed";
    const saveBlocked =
      this._loadState !== "ready" || !this._ssid.trim() || this._passwordTooShort;
    const label = failed
      ? "command.retry"
      : this._saving
        ? "onboarding.wifi.saving"
        : "onboarding.wifi.save";
    return html`<button
      type="button"
      class="btn btn--primary"
      ?disabled=${this._saving || (!failed && saveBlocked)}
      @click=${failed ? this._retry : this._save}
    >
      ${this._localize(label)}
    </button>`;
  }

  private _retry() {
    this._error = null;
    void this._loadAndFocus();
  }

  // The fields are disabled until the stored values land, so focus after;
  // a dismiss or re-open in the meantime owns focus instead.
  private async _loadAndFocus(): Promise<void> {
    const load = this._loadStored();
    const generation = this._generation; // bumped synchronously by the load above
    await load;
    await this.updateComplete;
    if (
      generation !== this._generation ||
      !this._dialog.open ||
      this._loadState !== "ready"
    ) {
      return;
    }
    this._ssidInput?.focus();
  }

  /** Seed the fields from the stored credentials, or hold the form (see `_loadState`). */
  private async _loadStored(): Promise<void> {
    const generation = ++this._generation;
    this._loadState = "loading";
    let yaml = "";
    let failed = false;
    try {
      yaml = await this._api.getConfig(SECRETS_FILE);
    } catch (err) {
      // No secrets.yaml yet is the first-run case: a blank form, not an error.
      failed = !isApiErrorCode(err, ErrorCode.NOT_FOUND);
    }
    // A re-open or dismiss superseded this load; it owns the fields now.
    if (generation !== this._generation) return;
    if (failed) {
      this._loadState = "failed";
      this._error = this._localize("onboarding.wifi.load_failed");
      return;
    }
    const values: string[] = [];
    for (const key of ["wifi_ssid", "wifi_password"]) {
      const value = inlineSecretValue(yaml, key);
      if (value === null) {
        this._loadState = "advanced";
        this._error = this._localize("onboarding.wifi.advanced_value", { key });
        return;
      }
      values.push(value);
    }
    [this._ssid, this._password] = values;
    this._storedPassword = this._password;
    this._loadState = "ready";
  }

  private async _save() {
    // The Enter path bypasses the disabled Save button, so guard re-entry here
    // too or a held Enter double-submits during the await below.
    // The footer stays mounted through the hide animation, so a dismissed dialog must not save.
    if (this._saving || this._loadState !== "ready" || !this._dialog.open) return;
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
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-onboarding-wifi-dialog": ESPHomeOnboardingWifiDialog;
  }
}
