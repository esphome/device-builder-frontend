import { consume } from "@lit/context";
import {
  mdiAlertOutline,
  mdiCodeBraces,
  mdiCogTransferOutline,
  mdiCompassOutline,
  mdiHandshake,
  mdiMemory,
  mdiServerNetwork,
  mdiSprout,
} from "@mdi/js";
import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { RemoteBuildPeer } from "../../api/types/remote-build.js";
import { ExperienceLevel } from "../../api/types/system.js";
import { activeLocale, type LocalizeFunc } from "../../common/localize.js";
import {
  apiContext,
  buildOffloadDiscoveredHostsContext,
  desktopVersionContext,
  isHaAddonContext,
  localizeContext,
} from "../../context/index.js";
import { MOBILE_BREAKPOINT } from "../../styles/breakpoints.js";
import { dialogActionButtonStyles } from "../../styles/dialog-action-buttons.js";
import { fullscreenMobileDialog } from "../../styles/dialog-mobile.js";
import { espHomeStyles } from "../../styles/shared.js";
import { withBase } from "../../util/base-path.js";
import { EnterController } from "../../util/enter-controller.js";
import { EXPERIENCE_OPTIONS } from "../../util/experience.js";
import { fireEvent } from "../../util/fire-event.js";
import { formatApiError } from "../../util/format-api-error.js";
import { notifyWarning } from "../../util/notify.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { remoteBuildPeerName } from "../../util/remote-build-peer-name.js";
import { closeOpenDialogs } from "../base-dialog.js";
import { featureListStyles } from "../shared/feature-list-styles.js";
import { REMOTE_COMPUTE_FEATURES, renderFeatureList } from "../shared/feature-list.js";
import { choiceCardStyles } from "./choice-card-styles.js";
import { onChoiceGroupKeydown, renderChoiceCard, rovingTabbable } from "./choice-card.js";
import { onboardingWizardStyles } from "./onboarding-wizard-styles.js";
import { wizardScreens, type UsageChoice, type WizardScreen } from "./wizard-screens.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/switch/switch.js";

export const RESET_ONBOARDING_PARAM = "resetOnboarding";
/** Companion to ``resetOnboarding``: ``&desktop=1`` previews the desktop-only
 *  usage screen on a dev backend that isn't the desktop wrapper. */
export const DESKTOP_ONBOARDING_PARAM = "desktop";

function viewportSupportsTour(): boolean {
  return !(
    typeof window.matchMedia === "function" &&
    window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches
  );
}

registerMdiIcons({
  "alert-outline": mdiAlertOutline,
  "code-braces": mdiCodeBraces,
  "cog-transfer-outline": mdiCogTransferOutline,
  "compass-outline": mdiCompassOutline,
  handshake: mdiHandshake,
  "server-network": mdiServerNetwork,
  sprout: mdiSprout,
  memory: mdiMemory,
});

/**
 * Mandatory first-run onboarding flow.
 *
 * A fresh install walks through Welcome and experience. When another Device
 * Builder is on the network (non-add-on installs), an orientation step follows
 * with an opt-in "remote compute only" switch. The choices are persisted before
 * the final tour offer appears, so "Maybe later" only skips the optional tour.
 * On phone-sized viewports there is no tour offer at all — completing the
 * choices closes the wizard straight onto the dashboard. Wi-Fi is
 * intentionally absent: the first Wi-Fi device that needs shared credentials
 * collects them.
 *
 * Under the desktop app a usage question follows Welcome: "standalone"
 * continues the flow above (minus the orientation step, which the question
 * subsumes), while "use as remote builder" persists remote_compute_only +
 * hide_device_builder and ends the wizard on the spot — the dashboard
 * reacts to the preference flip and lands on the remote-build pairing
 * onboarding instead of the device builder.
 *
 * ``?resetOnboarding=1`` reopens a clean default run for frontend development.
 * It does not reset data before opening; completing the choices writes them
 * through the same API path as first-run onboarding. Add ``&desktop=1`` to
 * preview the desktop-only usage screen on a non-desktop dev backend.
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

  /** Desktop wrapper version from the handshake; non-empty ⇒ running under
   *  the ESPHome Desktop app (the repo-wide "is desktop" signal). */
  @consume({ context: desktopVersionContext, subscribe: true })
  @state()
  private _desktopVersion = "";

  @state() private _open = false;
  @state() private _saving = false;
  @state() private _error: string | null = null;
  @state() private _index = 0;

  @state() private _remoteCompute = false;
  @state() private _experience: ExperienceLevel | null = ExperienceLevel.BEGINNER;
  // Frozen when leaving Welcome so mDNS hosts arriving mid-flow can't
  // insert/remove the existing-server screen under the user.
  @state() private _existingServerPinned = false;
  @state() private _showTour = viewportSupportsTour();
  // Frozen at open() like _showTour, so a reconnect can't add or remove the
  // usage screen mid-flow.
  @state() private _showUsage = false;
  @state() private _usage: UsageChoice | null = null;
  // The detection-based default, pinned when the usage screen is first
  // entered so a host discovered mid-screen can't flip the badge and the
  // preselection under the user. The warning banner stays live on purpose.
  @state() private _usageRecommended: UsageChoice | null = null;

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
    this._showTour = viewportSupportsTour();
    this._showUsage = Boolean(this._desktopVersion);
    this._usage = null;
    this._usageRecommended = null;
    this._startTourAfterClose = false;
    this._enter.set(true);
  }

  static styles = [
    espHomeStyles,
    dialogActionButtonStyles,
    choiceCardStyles,
    onboardingWizardStyles,
    featureListStyles,
    fullscreenMobileDialog("esphome-base-dialog"),
  ];

  /** Ordered screens for the current environment. */
  private get _screens(): WizardScreen[] {
    // existing_server sits after experience (index 1). While the user is still
    // on Welcome or experience the tail can grow as mDNS hosts arrive; freeze it
    // once they advance past experience so a late host can't shift the flow.
    const showExistingServer =
      this._index <= 1 ? this._computeShowExistingServer() : this._existingServerPinned;
    return wizardScreens({
      showUsage: this._showUsage,
      usage: this._usage,
      showExistingServer,
      showTour: this._showTour,
    });
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
      case "usage":
        return this._usage !== null;
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
        ?open=${this._open}
        ?busy=${this._saving}
        .label=${this._localize(this._titleKey)}
        @request-close=${this._onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        <div class="body${this._showUsage ? " body--usage-flow" : ""}">
          ${this._renderScreen()}
          ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : nothing}
        </div>
        <div slot="footer" class="actions">
          ${this._renderSteps()} ${this._renderActions()}
        </div>
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
      case "usage":
        return this._renderUsage();
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

  /** Usage options in display order. The standalone card carries the blue
   *  ESPHome logo (no mdi glyph exists for it); remote build keeps an mdi
   *  icon. */
  private static readonly USAGE_OPTIONS: ReadonlyArray<
    [UsageChoice, { icon?: string; imageSrc?: string }, string]
  > = [
    [
      "standalone",
      { imageSrc: withBase("/assets/logo/esphome-favicon.svg") },
      "standalone",
    ],
    ["remote_builder", { icon: "cog-transfer-outline" }, "remote"],
  ];

  private _renderUsage() {
    return html`
      <p class="intro">${this._localize("onboarding.wizard.usage.intro")}</p>
      <div
        class="choices"
        role="radiogroup"
        aria-label=${this._localize("onboarding.wizard.usage.title")}
        @keydown=${onChoiceGroupKeydown}
      >
        ${ESPHomeOnboardingWizardDialog.USAGE_OPTIONS.map(
          ([choice, visual, keyPrefix], index) =>
            renderChoiceCard({
              ...visual,
              title: this._localize(`onboarding.wizard.usage.${keyPrefix}_title`),
              description: this._localize(`onboarding.wizard.usage.${keyPrefix}_desc`),
              selected: this._usage === choice,
              tabbable: rovingTabbable(
                this._usage === choice,
                this._usage !== null,
                index
              ),
              badge:
                choice === this._usageRecommended
                  ? this._localize("onboarding.wizard.recommended")
                  : undefined,
              disabled: this._saving,
              onSelect: () => {
                this._usage = choice;
              },
            })
        )}
      </div>
    `;
  }

  /** Banner atop the experience screen when the user picked a standalone
   *  setup even though another Device Builder was discovered. Reads the
   *  live host map on purpose: a host that appears mid-flow should still
   *  raise the flag even though the badge/preselection stay pinned. The
   *  link takes the user back to the usage screen with remote build
   *  preselected, so Continue there completes the switch. */
  private _renderExistingNotice() {
    if (!this._showUsage || this._usage !== "standalone") return nothing;
    if (!this._discoveredHosts?.size) return nothing;
    return html`
      <div class="existing-notice" role="status">
        <wa-icon library="mdi" name="alert-outline" aria-hidden="true"></wa-icon>
        <span>
          ${this._localize("onboarding.wizard.experience.existing_notice")}
          <button type="button" class="notice-link" @click=${this._switchToRemoteBuild}>
            ${this._localize("onboarding.wizard.experience.existing_notice_link")}
          </button>
        </span>
      </div>
    `;
  }

  private _switchToRemoteBuild = () => {
    this._usage = "remote_builder";
    this._index = this._screens.indexOf("usage");
  };

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
        <div class="remote-feature-box">
          <p class="remote-feature-heading">
            ${this._localize("settings.remote_compute_features_title")}
          </p>
          ${renderFeatureList(this._localize, REMOTE_COMPUTE_FEATURES)}
        </div>
      </div>
    `;
  }

  private async _onToggleRemoteCompute(event: Event) {
    this._remoteCompute = (
      event.target as HTMLInputElement & { checked: boolean }
    ).checked;
    if (!this._remoteCompute) return;
    // The explainer sits below the toggle, often past the dialog's fold —
    // bring it into view so flipping the switch visibly does something.
    await this.updateComplete;
    // A quick off-flip while the render was pending cancels the scroll.
    if (!this._remoteCompute) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.shadowRoot
      ?.querySelector(".remote-feature-box")
      ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" });
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
      ${this._renderExistingNotice()}
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
        if (this._showUsage && this._usage === null) {
          // Pin the detection-based default the moment the question is
          // asked: existing install found ⇒ remote builder, else standalone.
          this._usageRecommended = this._discoveredHosts?.size
            ? "remote_builder"
            : "standalone";
          this._usage = this._usageRecommended;
        }
        this._index += 1;
        return;
      case "usage":
        if (this._usage === "remote_builder") {
          // Onboarding ends here; the dashboard flips to remote-build mode
          // (pairing onboarding first) as soon as the preference lands.
          await this._completeSetup();
          return;
        }
        this._index += 1;
        return;
      case "experience":
        // Freeze whether the orientation step follows, now that mDNS has had
        // Welcome + this screen to report. The usage screen subsumes the
        // orientation step, so it never pins on desktop.
        this._existingServerPinned =
          !this._showUsage && this._computeShowExistingServer();
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

    // A remote builder never gets the tour offer — the remote-build pairing
    // onboarding takes over the dashboard the moment the preference lands.
    if (this._showTour && this._usage !== "remote_builder") {
      this._index += 1;
    } else {
      this._open = false;
    }
  }

  private async _persistChoices(): Promise<boolean> {
    const remoteBuilder = this._usage === "remote_builder";
    try {
      await this._api.updatePreferences({
        experience_level: this._experience,
        remote_compute_only: remoteBuilder || this._remoteCompute,
        // Only the desktop usage question decides this: a remote builder
        // hides the Device builder entirely (the dashboard shows just the
        // remote-build screens), and a standalone pick resets it so a
        // re-run of onboarding can back out of a previous remote setup.
        ...(this._showUsage ? { hide_device_builder: remoteBuilder } : {}),
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
    if (this._open && !this._isTourOffer) {
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
    fireEvent(this, "open-guided-tour");
  }

  private _emitAcknowledged() {
    fireEvent(this, "onboarding-acknowledged");
  }

  private _consumeResetParam(): void {
    if (typeof __DEV__ === "undefined" || !__DEV__) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get(RESET_ONBOARDING_PARAM) !== "1") return;

    const forceDesktop = params.get(DESKTOP_ONBOARDING_PARAM) === "1";
    params.delete(RESET_ONBOARDING_PARAM);
    params.delete(DESKTOP_ONBOARDING_PARAM);
    const query = params.toString();
    const cleaned =
      window.location.pathname + (query ? `?${query}` : "") + window.location.hash;
    window.history.replaceState(window.history.state, "", cleaned);
    this.open();
    // The dev backend is never the desktop wrapper, so ``&desktop=1``
    // previews the desktop-only usage screen anyway. Applied after open()
    // (which derives the flag from the handshake) rather than by faking
    // _desktopVersion, which the context provider would overwrite.
    if (forceDesktop) this._showUsage = true;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-onboarding-wizard-dialog": ESPHomeOnboardingWizardDialog;
  }
}
