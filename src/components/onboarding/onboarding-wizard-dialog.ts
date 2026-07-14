import { consume } from "@lit/context";
import { mdiCodeBraces, mdiCompassOutline, mdiServerNetwork, mdiSprout } from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { RemoteBuildPeer } from "../../api/types/remote-build.js";
import { ExperienceLevel } from "../../api/types/system.js";
import { activeLocale, type LocalizeFunc } from "../../common/localize.js";
import {
  apiContext,
  buildOffloadDiscoveredHostsContext,
  isHaAddonContext,
  localizeContext,
} from "../../context/index.js";
import { dialogActionButtonStyles } from "../../styles/dialog-action-buttons.js";
import { fullscreenMobileDialog } from "../../styles/dialog-mobile.js";
import { espHomeStyles } from "../../styles/shared.js";
import { withBase } from "../../util/base-path.js";
import { EnterController } from "../../util/enter-controller.js";
import { EXPERIENCE_OPTIONS } from "../../util/experience.js";
import { formatApiError } from "../../util/format-api-error.js";
import { notifyWarning } from "../../util/notify.js";
import { remoteBuildPeerName } from "../../util/remote-build-peer-name.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { closeOpenDialogs } from "../base-dialog.js";
import { choiceCardStyles } from "./choice-card-styles.js";
import { onChoiceGroupKeydown, renderChoiceCard, rovingTabbable } from "./choice-card.js";
import { onboardingWizardStyles } from "./onboarding-wizard-styles.js";
import { type WizardScreen, wizardScreens } from "./wizard-screens.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/switch/switch.js";

export const RESET_ONBOARDING_PARAM = "resetOnboarding";

registerMdiIcons({
  "code-braces": mdiCodeBraces,
  "compass-outline": mdiCompassOutline,
  "server-network": mdiServerNetwork,
  sprout: mdiSprout,
});

/**
 * Mandatory first-run onboarding flow.
 *
 * A fresh install walks through Welcome and experience. When another Device
 * Builder is on the network (non-add-on installs), an orientation step follows
 * with an opt-in "remote compute only" switch. The choices are persisted before
 * the final tour offer appears, so "Maybe later" only skips the optional tour.
 * Wi-Fi is intentionally absent: the first Wi-Fi device that needs shared
 * credentials collects them.
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

  @consume({ context: buildOffloadDiscoveredHostsContext, subscribe: true })
  @state()
  private _discoveredHosts: Map<string, RemoteBuildPeer> | null = null;

  @consume({ context: isHaAddonContext, subscribe: true })
  @state()
  private _isHaAddon = false;

  @state() private _open = false;
  @state() private _saving = false;
  @state() private _error: string | null = null;
  @state() private _index = 0;

  @state() private _remoteCompute = false;
  @state() private _experience: ExperienceLevel | null = ExperienceLevel.BEGINNER;
  // Frozen when leaving Welcome so mDNS hosts arriving mid-flow can't
  // insert/remove the existing-server screen under the user.
  @state() private _existingServerPinned = false;

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
    this._remoteCompute = false;
    this._experience = ExperienceLevel.BEGINNER;
    this._existingServerPinned = false;
    this._startTourAfterClose = false;
    this._enter.set(true);
  }

  static styles = [
    espHomeStyles,
    dialogActionButtonStyles,
    choiceCardStyles,
    onboardingWizardStyles,
    fullscreenMobileDialog("esphome-base-dialog"),
  ];

  /** Ordered screens for the current environment. */
  private get _screens(): WizardScreen[] {
    // existing_server sits after experience (index 1). While the user is still
    // on Welcome or experience the tail can grow as mDNS hosts arrive; freeze it
    // once they advance past experience so a late host can't shift the flow.
    const showExistingServer =
      this._index <= 1 ? this._computeShowExistingServer() : this._existingServerPinned;
    return wizardScreens({ showExistingServer });
  }

  /** Offer the orientation step only off the HA add-on, and only when another
   *  Device Builder is on the network (nothing to build for otherwise). */
  private _computeShowExistingServer(): boolean {
    return !this._isHaAddon && !!this._discoveredHosts?.size;
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
      case "existing_server":
        return true;
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
      case "existing_server":
        return this._renderExistingServer();
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

  private _renderExistingServer() {
    const names = this._discoveredHosts
      ? [...new Set([...this._discoveredHosts.values()].map(remoteBuildPeerName))]
      : [];
    // Cap the named list so a busy network can't push the switch off-screen.
    const shown = names.slice(0, 3);
    const extra = names.length - shown.length;
    const joined = new Intl.ListFormat(activeLocale(), {
      type: extra > 0 ? "unit" : "conjunction",
    }).format(shown);
    const foundLabel =
      extra > 0
        ? this._localize("onboarding.wizard.existing_server.found_overflow", {
            name: joined,
            count: extra,
          })
        : this._localize("onboarding.wizard.existing_server.found", { name: joined });
    return html`
      <div class="existing-server">
        <wa-icon library="mdi" name="server-network" class="tour-offer-icon"></wa-icon>
        ${names.length ? html`<p class="tour-ready">${foundLabel}</p>` : nothing}
        <p class="intro">${this._localize("onboarding.wizard.existing_server.intro")}</p>
        <label class="remote-toggle">
          <span class="remote-toggle-text">
            <span class="remote-toggle-title">
              ${this._localize("onboarding.wizard.existing_server.remote_only_title")}
            </span>
            <span class="remote-toggle-desc">
              ${this._localize("onboarding.wizard.existing_server.remote_only_desc")}
            </span>
          </span>
          <wa-switch
            ?checked=${this._remoteCompute}
            ?disabled=${this._saving}
            aria-label=${this._localize("onboarding.wizard.existing_server.remote_only_title")}
            @change=${this._onToggleRemoteCompute}
          ></wa-switch>
        </label>
      </div>
    `;
  }

  private _onToggleRemoteCompute(event: Event) {
    this._remoteCompute = (
      event.target as HTMLInputElement & { checked: boolean }
    ).checked;
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

  private _chooseExperience(level: ExperienceLevel) {
    this._experience = level;
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
        // Freeze whether the orientation step follows, now that mDNS has had
        // Welcome + this screen to report.
        this._existingServerPinned = this._computeShowExistingServer();
        if (this._existingServerPinned) {
          this._index += 1;
          return;
        }
        await this._completeSetup();
        return;
      case "existing_server":
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
