import { consume } from "@lit/context";
import { mdiCodeBraces, mdiCursorDefaultClickOutline, mdiSprout } from "@mdi/js";
import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";

import { ExperienceLevel } from "../../api/types/system.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  experienceLevelContext,
  localizeContext,
  remoteComputeOnlyContext,
} from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { EXPERIENCE_OPTIONS } from "../../util/experience.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { choiceCardStyles } from "../onboarding/choice-card-styles.js";
import { onChoiceGroupKeydown, renderChoiceCard } from "../onboarding/choice-card.js";
import { settingsRowStyles, settingsSharedStyles } from "./shared-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  sprout: mdiSprout,
  "cursor-default-click-outline": mdiCursorDefaultClickOutline,
  "code-braces": mdiCodeBraces,
});

@customElement("esphome-settings-experience")
export class ESPHomeSettingsExperience extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: experienceLevelContext, subscribe: true })
  @state()
  private _experience: ExperienceLevel | null = null;

  @consume({ context: remoteComputeOnlyContext, subscribe: true })
  @state()
  private _remoteComputeOnly = false;

  static styles = [
    espHomeStyles,
    settingsSharedStyles,
    settingsRowStyles,
    choiceCardStyles,
    css`
      /* The content body has no top padding; this section leads with the
         intro (not a .row), so give it the same top breathing room a
         leading row would have. */
      .section-intro {
        margin-top: var(--wa-space-m);
      }
      /* Separate the remote-compute row from the experience cards. */
      .row {
        margin-top: var(--wa-space-m);
      }
    `,
  ];

  protected render() {
    return html`
      <p class="section-intro">${this._localize("settings.experience_intro")}</p>
      <div
        class="choices"
        role="radiogroup"
        aria-label=${this._localize("settings.experience")}
        @keydown=${onChoiceGroupKeydown}
      >
        ${EXPERIENCE_OPTIONS.map(([level, icon], i) =>
          renderChoiceCard({
            icon,
            title: this._localize(`onboarding.wizard.experience.${level}_title`),
            description: this._localize(`onboarding.wizard.experience.${level}_desc`),
            selected: this._experience === level,
            tabbable:
              this._experience === level || (this._experience === null && i === 0),
            onSelect: () => this._setExperience(level),
          })
        )}
      </div>
      <div class="row">
        <div class="row-label">
          <span id="remote-compute-title" class="row-title">
            ${this._localize("settings.remote_compute_only")}
          </span>
          <span class="row-desc">
            ${this._localize("settings.remote_compute_only_desc")}
          </span>
        </div>
        <button
          class="toggle"
          role="switch"
          aria-labelledby="remote-compute-title"
          aria-checked=${this._remoteComputeOnly}
          @click=${this._toggleRemoteCompute}
        ></button>
      </div>
    `;
  }

  private _setExperience(level: ExperienceLevel) {
    if (level === this._experience) return;
    this.dispatchEvent(
      new CustomEvent("set-experience-level", {
        detail: level,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _toggleRemoteCompute() {
    this.dispatchEvent(
      new CustomEvent("set-remote-compute-only", {
        detail: !this._remoteComputeOnly,
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-experience": ESPHomeSettingsExperience;
  }
}
