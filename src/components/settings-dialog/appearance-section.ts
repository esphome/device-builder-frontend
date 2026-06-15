import { consume } from "@lit/context";
import { mdiChevronDown, mdiCodeBraces, mdiMagnify, mdiVectorDifference } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import {
  expertModeContext,
  localizeContext,
  remoteComputeOnlyContext,
} from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { settingsRowStyles, settingsSharedStyles } from "./shared-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

registerMdiIcons({
  "chevron-down": mdiChevronDown,
  "code-braces": mdiCodeBraces,
  magnify: mdiMagnify,
  "vector-difference": mdiVectorDifference,
});

const EXPERT_FEATURES: { icon: string; titleKey: string; descKey: string }[] = [
  {
    icon: "vector-difference",
    titleKey: "settings.expert_mode_feature_diff",
    descKey: "settings.expert_mode_feature_diff_desc",
  },
  {
    icon: "magnify",
    titleKey: "settings.expert_mode_feature_navigator",
    descKey: "settings.expert_mode_feature_navigator_desc",
  },
  {
    icon: "code-braces",
    titleKey: "settings.expert_mode_feature_yaml",
    descKey: "settings.expert_mode_feature_yaml_desc",
  },
];

@customElement("esphome-settings-appearance")
export class ESPHomeSettingsAppearance extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: expertModeContext, subscribe: true })
  @state()
  private _expertMode = false;

  @consume({ context: remoteComputeOnlyContext, subscribe: true })
  @state()
  private _remoteComputeOnly = false;

  @state()
  private _theme: string = localStorage.getItem("esphome-theme") ?? "system";

  // Collapsed by default so the feature list doesn't lengthen the page.
  @state()
  private _featuresOpen = false;

  static styles = [
    espHomeStyles,
    inputStyles,
    settingsSharedStyles,
    settingsRowStyles,
    css`
      .expert-row {
        border-bottom: none;
        padding-bottom: var(--wa-space-2xs);
      }

      .expert-features {
        margin: var(--wa-space-s) 0 var(--wa-space-m);
        padding: var(--wa-space-s) var(--wa-space-m);
        background: var(--wa-color-surface-lowered);
        border-radius: var(--wa-border-radius-m);
      }

      .expert-features-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 0;
        background: none;
        border: none;
        cursor: pointer;
        color: inherit;
      }

      .expert-features-heading {
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .expert-features-chevron {
        font-size: 18px;
        color: var(--wa-color-text-quiet);
        flex-shrink: 0;
        transition: transform 0.15s;
      }

      .expert-features-toggle[aria-expanded="true"] .expert-features-chevron {
        transform: rotate(180deg);
      }

      .expert-feature-list {
        list-style: none;
        margin: var(--wa-space-s) 0 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
      }

      .expert-feature {
        display: flex;
        align-items: flex-start;
        gap: var(--wa-space-s);
      }

      .expert-feature wa-icon {
        font-size: 18px;
        color: var(--esphome-primary);
        flex-shrink: 0;
        margin-top: 1px;
      }

      .expert-feature-text {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
      }

      .expert-feature-title {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-normal);
      }

      .expert-feature-desc {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }
    `,
  ];

  protected render() {
    return html`
      <div class="row row--stacked">
        <div class="row-label">
          <span class="row-title">${this._localize("layout.theme")}</span>
          <span class="row-desc">${this._localize("settings.theme_desc")}</span>
        </div>
        <wa-select value=${this._theme} @change=${this._onChange}>
          <wa-option value="light">${this._localize("layout.theme_light")}</wa-option>
          <wa-option value="dark">${this._localize("layout.theme_dark")}</wa-option>
          <wa-option value="system">${this._localize("layout.theme_system")}</wa-option>
        </wa-select>
      </div>
      ${this._renderExpertMode()} ${this._renderRemoteCompute()}
    `;
  }

  private _renderRemoteCompute() {
    return html`
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
          @click=${this._onToggleRemoteCompute}
        ></button>
      </div>
    `;
  }

  private _renderExpertMode() {
    return html`
      <div class="row expert-row">
        <div class="row-label">
          <span id="expert-mode-title" class="row-title">
            ${this._localize("settings.expert_mode")}
          </span>
          <span class="row-desc">${this._localize("settings.expert_mode_desc")}</span>
        </div>
        <button
          class="toggle"
          role="switch"
          aria-labelledby="expert-mode-title"
          aria-checked=${this._expertMode}
          @click=${this._onToggleExpertMode}
        ></button>
      </div>
      <div class="expert-features">
        <button
          class="expert-features-toggle"
          type="button"
          aria-expanded=${this._featuresOpen ? "true" : "false"}
          @click=${this._onToggleFeatures}
        >
          <span class="expert-features-heading">
            ${this._localize("settings.expert_mode_features_title")}
          </span>
          <wa-icon
            class="expert-features-chevron"
            library="mdi"
            name="chevron-down"
            aria-hidden="true"
          ></wa-icon>
        </button>
        ${this._featuresOpen
          ? html`
              <ul class="expert-feature-list">
                ${EXPERT_FEATURES.map(
                  (f) => html`
                    <li class="expert-feature">
                      <wa-icon library="mdi" name=${f.icon}></wa-icon>
                      <div class="expert-feature-text">
                        <span class="expert-feature-title">
                          ${this._localize(f.titleKey)}
                        </span>
                        <span class="expert-feature-desc">
                          ${this._localize(f.descKey)}
                        </span>
                      </div>
                    </li>
                  `
                )}
              </ul>
            `
          : nothing}
      </div>
    `;
  }

  private _onToggleFeatures() {
    this._featuresOpen = !this._featuresOpen;
  }

  private _onChange(e: Event) {
    const theme = (e.target as HTMLSelectElement).value;
    this._theme = theme;
    this.dispatchEvent(
      new CustomEvent("set-theme", {
        detail: theme,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onToggleExpertMode() {
    this.dispatchEvent(
      new CustomEvent("set-expert-mode", {
        detail: !this._expertMode,
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onToggleRemoteCompute() {
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
    "esphome-settings-appearance": ESPHomeSettingsAppearance;
  }
}
