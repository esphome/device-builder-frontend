import { consume } from "@lit/context";
import {
  mdiCodeBraces,
  mdiCompassOutline,
  mdiLaptop,
  mdiServerNetwork,
  mdiSprout,
} from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import { ExperienceLevel } from "../../api/types/system.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { dialogActionButtonStyles } from "../../styles/dialog-action-buttons.js";
import { espHomeStyles } from "../../styles/shared.js";
import { withBase } from "../../util/base-path.js";
import { EnterController } from "../../util/enter-controller.js";
import { EXPERIENCE_OPTIONS } from "../../util/experience.js";
import { formatApiError } from "../../util/format-api-error.js";
import { notifyWarning } from "../../util/notify.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { closeOpenDialogs } from "../base-dialog.js";
import { choiceCardStyles } from "./choice-card-styles.js";
import { onChoiceGroupKeydown, renderChoiceCard, rovingTabbable } from "./choice-card.js";
import { onboardingWizardStyles } from "./onboarding-wizard-styles.js";
import { type WizardScreen, wizardScreens } from "./wizard-screens.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

export const RESET_ONBOARDING_PARAM = "resetOnboarding";

registerMdiIcons({
  "code-braces": mdiCodeBraces,
  "compass-outline": mdiCompassOutline,
  laptop: mdiLaptop,
  "server-network": mdiServerNetwork,
  sprout: mdiSprout,
});

/**
 * Mandatory first-run onboarding flow.
 *
 * A fresh install walks through Welcome and experience. Expert users on non-HA
 * installs also choose a use case. The choices are persisted before the final
 * tour offer appears, so "Maybe later" only skips the optional tour. Wi-Fi is
 * intentionally absent: the first Wi-Fi device that needs shared credentials
 * collects them.
 *
 * ``?resetOnboarding=1`` reopens a clean default run for frontend development.
 * It does not reset data before opening; completing the choices writes them
 * through the same API path as first-run onboarding.
 */
@customElement("esphome-onboarding-wizard-dialog")
export class ESPHomeOnboardingWizardDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  /** Whether this install can ask expert users the remote-compute use-case
   *  question (non-HA only). Seeded by the app shell from onboarding state. */
  @property({ type: Boolean }) hasUseCase = false;

  @state() private _open = false;
  @state() private _saving = false;
  @state() private _error: string | null = null;
  @state() private _index = 0;

  @state() private _useCaseChosen = true;
  @state() private _remoteCompute = false;
  @state() private _experience: ExperienceLevel | null = ExperienceLevel.BEGINNER;

  private _startTourAfterClose = false;
  private _enter = new EnterController(this, () => {
    if (this._isTourOffer) {
      if (this._remoteCompute) this._maybeLater();
      else this._startTour();
      return;
    }
    if (this._canContinue) void this._onContinue();
  });

  connectedCallback(): void {
    super.connectedCallback();
    this._consumeResetParam();
  }

  open() {
    if (this._open) return;
    closeOpenDialogs(this);
    this._open = true;
    this._saving = false;
    this._error = null;
    this._index = 0;
    this._useCaseChosen = true;
    this._remoteCompute = false;
    this._experience = ExperienceLevel.BEGINNER;
    this._startTourAfterClose = false;
    this._enter.set(true);
  }

  static styles = [
    espHomeStyles,
    dialogActionButtonStyles,
    choiceCardStyles,
    onboardingWizardStyles,
  ];

  /** Ordered screens for the current environment. */
  private get _screens(): WizardScreen[] {
    return wizardScreens({
      hasUseCase: this.hasUseCase,
      isExpert: this._experience === ExperienceLevel.EXPERT,
    });
  }

  private get _screen(): WizardScreen {
    return this._screens[this._index];
  }

  private get _isTourOffer(): boolean {
    return this._screen === "tour";
  }

  private get _titleKey(): string {
    return this._isTourOffer && this._remoteCompute
      ? "onboarding.wizard.tour.remote_title"
      : `onboarding.wizard.${this._screen}.title`;
  }

  private get _canContinue(): boolean {
    if (this._saving) return false;
    switch (this._screen) {
      case "welcome":
        return true;
      case "use_case":
        return this._useCaseChosen;
      case "experience":
        return this._experience !== null;
      case "tour":
        return false;
    }
  }

  protected render() {
    return html`
      <esphome-base-dialog
        class=${this._isTourOffer ? "" : "mandatory"}
        ?open=${this._open}
        ?busy=${this._saving}
        .label=${this._localize(this._titleKey)}
        @request-close=${this._onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        <div class="body">
          ${this._renderSteps()} ${this._renderScreen()}
          ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
        </div>
        <div slot="footer" class="actions">${this._renderActions()}</div>
      </esphome-base-dialog>
    `;
  }

  private _renderActions() {
    if (this._isTourOffer) {
      if (this._remoteCompute) {
        return html`
          <span class="spacer"></span>
          <button type="button" class="btn btn--primary" @click=${this._maybeLater}>
            ${this._localize("onboarding.wizard.done")}
          </button>
        `;
      }
      return html`
        <button type="button" class="btn btn--cancel" @click=${this._maybeLater}>
          ${this._localize("onboarding.wizard.dismiss")}
        </button>
        <span class="spacer"></span>
        <button type="button" class="btn btn--primary" @click=${this._startTour}>
          ${this._localize("onboarding.wizard.start_tour")}
        </button>
      `;
    }

    return html`
      ${
        this._index > 0
          ? html`<button
              type="button"
              class="btn btn--cancel"
              ?disabled=${this._saving}
              @click=${this._onBack}
            >
              ${this._localize("onboarding.wizard.back")}
            </button>`
          : nothing
      }
      <span class="spacer"></span>
      <button
        type="button"
        class="btn btn--primary"
        ?disabled=${!this._canContinue}
        @click=${this._onContinue}
      >
        ${
          this._saving
            ? this._localize("onboarding.wizard.saving")
            : this._localize("onboarding.wizard.continue")
        }
      </button>
    `;
  }

  private _renderSteps() {
    return html`<div class="steps" aria-hidden="true">
      ${this._screens.map(
        (_screen, index) =>
          html`<span class="step-dot ${index === this._index ? "active" : ""}"></span>`
      )}
    </div>`;
  }

  private _renderScreen() {
    switch (this._screen) {
      case "welcome":
        return this._renderWelcome();
      case "use_case":
        return this._renderUseCase();
      case "experience":
        return this._renderExperience();
      case "tour":
        return this._renderTourOffer();
    }
  }

  private _renderWelcome() {
    return html`
      <div class="welcome-screen">
        <img
          class="welcome-logo"
          src=${withBase("/assets/logo/esphome-favicon.svg")}
          alt=""
        />
        <p class="intro">${this._localize("onboarding.wizard.welcome.intro")}</p>
      </div>
    `;
  }

  private _renderTourOffer() {
    if (this._remoteCompute) {
      return html`
        <div class="tour-offer">
          <wa-icon library="mdi" name="server-network" class="tour-offer-icon"></wa-icon>
          <p class="tour-ready">
            ${this._localize("onboarding.wizard.tour.remote_ready")}
          </p>
          <p class="intro">${this._localize("onboarding.wizard.tour.remote_intro")}</p>
        </div>
      `;
    }
    return html`
      <div class="tour-offer">
        <wa-icon library="mdi" name="compass-outline" class="tour-offer-icon"></wa-icon>
        <p class="tour-ready">${this._localize("onboarding.wizard.tour.ready")}</p>
        <p class="intro">${this._localize("onboarding.wizard.tour.intro")}</p>
        <p class="intro">${this._localize("onboarding.wizard.tour.later")}</p>
      </div>
    `;
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
          icon: "laptop",
          title: this._localize("onboarding.wizard.use_case.devices_title"),
          description: this._localize("onboarding.wizard.use_case.devices_desc"),
          selected: devices,
          tabbable: rovingTabbable(devices, this._useCaseChosen, 0),
          badge: this._localize("onboarding.wizard.recommended"),
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
        ${EXPERIENCE_OPTIONS.map(([level, icon], index) =>
          renderChoiceCard({
            icon,
            title: this._localize(`onboarding.wizard.experience.${level}_title`),
            description: this._localize(`onboarding.wizard.experience.${level}_desc`),
            selected: this._experience === level,
            tabbable: rovingTabbable(
              this._experience === level,
              this._experience !== null,
              index
            ),
            badge:
              level === ExperienceLevel.BEGINNER
                ? this._localize("onboarding.wizard.recommended")
                : undefined,
            disabled: this._saving,
            onSelect: () => this._chooseExperience(level),
          })
        )}
      </div>
    `;
  }

  private _chooseUseCase(remoteCompute: boolean) {
    this._useCaseChosen = true;
    this._remoteCompute = remoteCompute;
  }

  private _chooseExperience(level: ExperienceLevel) {
    this._experience = level;
    if (level === ExperienceLevel.BEGINNER) {
      this._useCaseChosen = true;
      this._remoteCompute = false;
    }
  }

  private _onBack() {
    this._error = null;
    if (this._index > 0) this._index -= 1;
  }

  private async _onContinue() {
    this._error = null;
    switch (this._screen) {
      case "welcome":
        this._index += 1;
        return;
      case "experience":
        if (this.hasUseCase && this._experience === ExperienceLevel.EXPERT) {
          this._index += 1;
          return;
        }
        await this._completeSetup();
        return;
      case "use_case":
        await this._completeSetup();
        return;
      case "tour":
        return;
    }
  }

  private async _completeSetup() {
    if (this._saving) return;
    this._saving = true;
    if (!(await this._persistChoices())) return;
    try {
      await this._api.markOnboardingAcknowledged();
    } catch (err) {
      console.warn("Failed to mark onboarding acknowledged:", err);
      notifyWarning(this._localize("onboarding.wizard.ack_failed"));
    }
    this._emitAcknowledged();
    this._saving = false;
    this._index += 1;
  }

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

  private _maybeLater = () => {
    this._open = false;
  };

  private _startTour = () => {
    this._startTourAfterClose = true;
    this._open = false;
  };

  private _onRequestClose = (event: Event): void => {
    if (!this._isTourOffer) {
      event.preventDefault();
      return;
    }
    this._open = false;
  };

  private _onAfterHide() {
    this._enter.set(false);
    this._open = false;
    if (!this._startTourAfterClose) return;
    this._startTourAfterClose = false;
    this.dispatchEvent(
      new CustomEvent("open-guided-tour", { bubbles: true, composed: true })
    );
  }

  private _emitAcknowledged() {
    this.dispatchEvent(
      new CustomEvent("onboarding-acknowledged", { bubbles: true, composed: true })
    );
  }

  private _consumeResetParam(): void {
    if (typeof __DEV__ === "undefined" || !__DEV__) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get(RESET_ONBOARDING_PARAM) !== "1") return;

    params.delete(RESET_ONBOARDING_PARAM);
    const query = params.toString();
    const cleaned =
      window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
    window.history.replaceState(window.history.state, "", cleaned);
    this.open();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-onboarding-wizard-dialog": ESPHomeOnboardingWizardDialog;
  }
}
