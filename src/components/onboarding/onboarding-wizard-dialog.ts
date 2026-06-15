import { consume } from "@lit/context";
import {
  mdiChip,
  mdiCodeBraces,
  mdiCursorDefaultClickOutline,
  mdiServerNetwork,
  mdiSprout,
  mdiWifi,
} from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../../api/index.js";
import { ExperienceLevel } from "../../api/types/system.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { dialogActionButtonStyles } from "../../styles/dialog-action-buttons.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { EnterController } from "../../util/enter-controller.js";
import { EXPERIENCE_OPTIONS } from "../../util/experience.js";
import { formatApiError } from "../../util/format-api-error.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { choiceCardStyles } from "./choice-card-styles.js";
import { onChoiceGroupKeydown, renderChoiceCard, rovingTabbable } from "./choice-card.js";
import { onboardingWizardStyles } from "./onboarding-wizard-styles.js";
import { wifiFieldsStyles } from "./wifi-fields-styles.js";
import { isWifiPasswordTooShort, renderWifiFields } from "./wifi-fields.js";
import { type WizardScreen, wizardScreens } from "./wizard-screens.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "../base-dialog.js";

registerMdiIcons({
  wifi: mdiWifi,
  chip: mdiChip,
  "server-network": mdiServerNetwork,
  sprout: mdiSprout,
  "cursor-default-click-outline": mdiCursorDefaultClickOutline,
  "code-braces": mdiCodeBraces,
});

/**
 * First-run onboarding wizard.
 *
 * Auto-popped by the app shell for a fresh install. Walks a short stepped
 * flow whose shape depends on the environment and the user's use-case
 * choice: non-HA installs lead with the remote-compute question; choosing
 * remote-compute drops the Wi-Fi step. The experience pick and remote-compute
 * choice are persisted directly via ``updatePreferences``; the Wi-Fi step
 * writes ``secrets.yaml`` directly. The final step emits
 * ``onboarding-acknowledged`` (or ``onboarding-dismissed-session`` when Wi-Fi
 * is skipped) so the app shell reloads preferences into context and the flow
 * does not auto-pop again.
 *
 * Standalone Wi-Fi credential rotation stays in ``esphome-onboarding-wifi-dialog``;
 * this component is the first-run flow only.
 */
@customElement("esphome-onboarding-wizard-dialog")
export class ESPHomeOnboardingWizardDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  /** Whether this install asks the remote-compute use-case question
   *  (non-HA only). Seeded by the app shell from the onboarding state. */
  @property({ type: Boolean }) hasUseCase = false;

  @state() private _open = false;
  @state() private _saving = false;
  @state() private _error: string | null = null;
  @state() private _index = 0;

  @state() private _useCaseChosen = false;
  @state() private _remoteCompute = false;
  @state() private _experience: ExperienceLevel | null = null;
  @state() private _ssid = "";
  @state() private _password = "";

  private _exitedExplicitly = false;
  private _enter = new EnterController(this, () => {
    if (this._canContinue) void this._onContinue();
  });

  open() {
    this._open = true;
    this._saving = false;
    this._error = null;
    this._index = 0;
    this._useCaseChosen = false;
    this._remoteCompute = false;
    this._experience = null;
    this._ssid = "";
    this._password = "";
    this._exitedExplicitly = false;
    this._enter.set(true);
  }

  close() {
    this._open = false;
  }

  static styles = [
    espHomeStyles,
    inputStyles,
    dialogActionButtonStyles,
    choiceCardStyles,
    wifiFieldsStyles,
    onboardingWizardStyles,
  ];

  /** Ordered screens for the current choices. */
  private get _screens(): WizardScreen[] {
    return wizardScreens({
      hasUseCase: this.hasUseCase,
      remoteCompute: this._remoteCompute,
    });
  }

  private get _screen(): WizardScreen {
    return this._screens[this._index];
  }

  private get _isLast(): boolean {
    return this._index === this._screens.length - 1;
  }

  private get _passwordTooShort(): boolean {
    return isWifiPasswordTooShort(this._password);
  }

  private get _canContinue(): boolean {
    if (this._saving) return false;
    switch (this._screen) {
      case "use_case":
        return this._useCaseChosen;
      case "experience":
        return this._experience !== null;
      case "wifi":
        return this._ssid.trim().length > 0 && !this._passwordTooShort;
    }
  }

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        ?busy=${this._saving}
        .label=${this._localize(`onboarding.wizard.${this._screen}.title`)}
        @request-close=${this._onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        <div class="body">
          ${this._renderSteps()} ${this._renderScreen()}
          ${this._error
            ? html`<p class="error" role="alert">${this._error}</p>`
            : nothing}
        </div>
        <div slot="footer" class="actions">
          ${this._index > 0
            ? html`<button
                type="button"
                class="btn btn--cancel"
                ?disabled=${this._saving}
                @click=${this._onBack}
              >
                ${this._localize("onboarding.wizard.back")}
              </button>`
            : html`<button
                type="button"
                class="btn btn--cancel"
                ?disabled=${this._saving}
                @click=${this._dismissForSession}
              >
                ${this._localize("onboarding.wizard.dismiss")}
              </button>`}
          <span class="spacer"></span>
          ${this._screen === "wifi"
            ? html`<button
                type="button"
                class="btn btn--cancel"
                ?disabled=${this._saving}
                @click=${this._onSkipWifi}
              >
                ${this._localize("onboarding.wizard.skip")}
              </button>`
            : nothing}
          <button
            type="button"
            class="btn btn--primary"
            ?disabled=${!this._canContinue}
            @click=${this._onContinue}
          >
            ${this._saving
              ? this._localize("onboarding.wizard.saving")
              : this._isLast
                ? this._localize("onboarding.wizard.finish")
                : this._localize("onboarding.wizard.continue")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  private _renderSteps() {
    // Purely decorative progress dots; the step itself is announced via the
    // dialog label, so keep these out of the accessibility tree.
    return html`<div class="steps" aria-hidden="true">
      ${this._screens.map(
        (_s, i) =>
          html`<span class="step-dot ${i === this._index ? "active" : ""}"></span>`
      )}
    </div>`;
  }

  private _renderScreen() {
    switch (this._screen) {
      case "use_case":
        return this._renderUseCase();
      case "experience":
        return this._renderExperience();
      case "wifi":
        return this._renderWifi();
    }
  }

  private _renderUseCase() {
    const devices = this._useCaseChosen && !this._remoteCompute;
    const remote = this._useCaseChosen && this._remoteCompute;
    return html`
      <p class="intro">${this._localize("onboarding.wizard.use_case.intro")}</p>
      <div
        class="choices"
        role="radiogroup"
        aria-label=${this._localize("onboarding.wizard.use_case.title")}
        @keydown=${onChoiceGroupKeydown}
      >
        ${renderChoiceCard({
          icon: "chip",
          title: this._localize("onboarding.wizard.use_case.devices_title"),
          description: this._localize("onboarding.wizard.use_case.devices_desc"),
          selected: devices,
          tabbable: rovingTabbable(devices, this._useCaseChosen, 0),
          disabled: this._saving,
          onSelect: () => this._chooseUseCase(false),
        })}
        ${renderChoiceCard({
          icon: "server-network",
          title: this._localize("onboarding.wizard.use_case.remote_title"),
          description: this._localize("onboarding.wizard.use_case.remote_desc"),
          selected: remote,
          tabbable: rovingTabbable(remote, this._useCaseChosen, 1),
          disabled: this._saving,
          onSelect: () => this._chooseUseCase(true),
        })}
      </div>
    `;
  }

  private _renderExperience() {
    return html`
      <p class="intro">${this._localize("onboarding.wizard.experience.intro")}</p>
      <div
        class="choices"
        role="radiogroup"
        aria-label=${this._localize("onboarding.wizard.experience.title")}
        @keydown=${onChoiceGroupKeydown}
      >
        ${EXPERIENCE_OPTIONS.map(([level, icon], i) =>
          renderChoiceCard({
            icon,
            title: this._localize(`onboarding.wizard.experience.${level}_title`),
            description: this._localize(`onboarding.wizard.experience.${level}_desc`),
            selected: this._experience === level,
            tabbable: rovingTabbable(
              this._experience === level,
              this._experience !== null,
              i
            ),
            disabled: this._saving,
            onSelect: () => {
              this._experience = level;
            },
          })
        )}
      </div>
    `;
  }

  private _renderWifi() {
    return html`
      <p class="intro">
        <wa-icon library="mdi" name="wifi"></wa-icon>
        ${this._localize("onboarding.wizard.wifi.intro")}
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
    `;
  }

  private _chooseUseCase(remoteCompute: boolean) {
    this._useCaseChosen = true;
    this._remoteCompute = remoteCompute;
  }

  private _onBack() {
    this._error = null;
    if (this._index > 0) this._index -= 1;
  }

  private async _onContinue() {
    this._error = null;
    switch (this._screen) {
      case "use_case":
        this._index += 1;
        return;
      case "experience":
        if (this._isLast) {
          await this._finish();
        } else {
          this._index += 1;
        }
        return;
      case "wifi":
        await this._finishWithWifi();
        return;
    }
  }

  private async _onSkipWifi() {
    if (this._saving) return;
    this._saving = true;
    this._error = null;
    // "Skip" is "remind me later", not a permanent decline. Persist the
    // experience pick but do NOT acknowledge, so the standalone Wi-Fi dialog
    // (which carries the explicit "I don't use Wi-Fi" decline) re-asks on the
    // next login while Wi-Fi is still unconfigured. Session-dismiss so it
    // doesn't immediately re-pop this session.
    if (!(await this._persistChoices())) return;
    this._saving = false;
    this._dismissForSession();
  }

  private async _finishWithWifi() {
    if (this._saving) return;
    if (!this._ssid.trim() || this._passwordTooShort) return;
    this._saving = true;
    this._error = null;
    try {
      await this._api.setOnboardingWifi(this._ssid, this._password);
    } catch (err) {
      this._error = formatApiError(err, this._localize, "onboarding.wifi.save_failed");
      this._saving = false;
      return;
    }
    window.dispatchEvent(new CustomEvent("secrets-saved", { detail: { source: this } }));
    await this._acknowledgeAndClose();
  }

  private async _finish() {
    if (this._saving) return;
    this._saving = true;
    this._error = null;
    await this._acknowledgeAndClose();
  }

  /** Persist the experience / remote-compute picks; returns false and shows an
   *  inline error on failure. */
  private async _persistChoices(): Promise<boolean> {
    try {
      await this._api.updatePreferences({
        experience_level: this._experience,
        remote_compute_only: this._remoteCompute,
      });
      return true;
    } catch (err) {
      this._error = formatApiError(
        err,
        this._localize,
        "settings.experience_save_failed"
      );
      this._saving = false;
      return false;
    }
  }

  private async _acknowledgeAndClose() {
    // Persist the picks BEFORE acknowledging, so a failed write can't leave
    // the wizard marked done with experience / remote-compute unset (which
    // would never re-pop). The app shell refreshes its context from these
    // prefs on the onboarding-acknowledged event.
    if (!(await this._persistChoices())) return;
    try {
      await this._api.markOnboardingAcknowledged();
    } catch (err) {
      // Prefs already landed; a failed ack only re-pops the wizard next load.
      console.warn("Failed to mark onboarding acknowledged:", err);
      toast.warning(this._localize("onboarding.wizard.ack_failed"), { richColors: true });
    }
    this._exitedExplicitly = true;
    this._emitAcknowledged();
    this.close();
    this._saving = false;
  }

  private _onAfterHide() {
    this._enter.set(false);
    if (!this._exitedExplicitly) this._dismissForSession();
  }

  private _onRequestClose = (): void => {
    this._open = false;
  };

  private _dismissForSession = () => {
    this._exitedExplicitly = true;
    this.dispatchEvent(
      new CustomEvent("onboarding-dismissed-session", { bubbles: true, composed: true })
    );
    this.close();
  };

  private _emitAcknowledged() {
    this.dispatchEvent(
      new CustomEvent("onboarding-acknowledged", { bubbles: true, composed: true })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-onboarding-wizard-dialog": ESPHomeOnboardingWizardDialog;
  }
}
