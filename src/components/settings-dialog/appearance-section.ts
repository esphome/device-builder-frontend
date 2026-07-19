import { consume } from "@lit/context";
import {
  mdiCodeBraces,
  mdiFileCompare,
  mdiHandshake,
  mdiMagnify,
  mdiServerNetwork,
  mdiMemory,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import {
  expertModeContext,
  localizeContext,
  hideDeviceBuilderContext,
  remoteComputeOnlyContext,
  versionHistoryEnabledContext,
} from "../../context/index.js";
import { disclosureStyles } from "../../styles/disclosure.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { storedTheme } from "../../util/dark-mode.js";
import { fireEvent } from "../../util/fire-event.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { renderDisclosure } from "../shared/disclosure.js";
import {
  REMOTE_COMPUTE_FEATURES,
  renderFeatureList,
  type FeatureItem,
} from "../shared/feature-list.js";
import { featureListStyles } from "../shared/feature-list-styles.js";
import { renderToggleRow } from "./settings-rows.js";
import { settingsRowStyles, settingsSharedStyles } from "./shared-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

registerMdiIcons({
  "code-braces": mdiCodeBraces,
  magnify: mdiMagnify,
  "file-compare": mdiFileCompare,
  handshake: mdiHandshake,
  "server-network": mdiServerNetwork,
  memory: mdiMemory,
});

const EXPERT_FEATURES: FeatureItem[] = [
  {
    icon: "file-compare",
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

  @consume({ context: hideDeviceBuilderContext, subscribe: true })
  @state()
  private _hideDeviceBuilder = false;

  @consume({ context: versionHistoryEnabledContext, subscribe: true })
  @state()
  private _versionHistoryEnabled = true;

  @state()
  private _theme: string = storedTheme();

  // Collapsed by default so the feature lists don't lengthen the page.
  @state()
  private _featuresOpen = false;

  @state()
  private _remoteFeaturesOpen = false;

  static styles = [
    espHomeStyles,
    inputStyles,
    settingsSharedStyles,
    settingsRowStyles,
    disclosureStyles,
    featureListStyles,
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
      ${this._expertMode ? this._renderVersionHistory() : nothing}
    `;
  }

  // Expert-only: a beginner keeps version history on as a safety net, so the
  // off switch is hidden unless Expert Mode is enabled.
  private _renderVersionHistory() {
    return renderToggleRow(this._localize, {
      titleId: "version-history-title",
      titleKey: "settings.version_history",
      descKey: "settings.version_history_desc",
      checked: this._versionHistoryEnabled,
      onToggle: this._onToggleVersionHistory,
    });
  }

  private _renderRemoteCompute() {
    return html`
      ${renderToggleRow(this._localize, {
        titleId: "remote-compute-title",
        titleKey: "settings.remote_compute_only",
        descKey: "settings.remote_compute_only_desc",
        checked: this._remoteComputeOnly,
        onToggle: this._onToggleRemoteCompute,
        rowClass: "expert-row",
      })}
      ${this._renderFeaturesBox(
        "settings.remote_compute_features_title",
        REMOTE_COMPUTE_FEATURES,
        this._remoteFeaturesOpen,
        () => {
          this._remoteFeaturesOpen = !this._remoteFeaturesOpen;
        }
      )}
      ${
        this._remoteComputeOnly
          ? renderToggleRow(this._localize, {
              titleId: "hide-device-builder-title",
              titleKey: "settings.hide_device_builder",
              descKey: "settings.hide_device_builder_desc",
              checked: this._hideDeviceBuilder,
              onToggle: this._onToggleHideDeviceBuilder,
              rowClass: "expert-row",
            })
          : nothing
      }
    `;
  }

  private _renderExpertMode() {
    return html`
      ${renderToggleRow(this._localize, {
        titleId: "expert-mode-title",
        titleKey: "settings.expert_mode",
        descKey: "settings.expert_mode_desc",
        checked: this._expertMode,
        onToggle: this._onToggleExpertMode,
        rowClass: "expert-row",
      })}
      ${this._renderFeaturesBox(
        "settings.expert_mode_features_title",
        EXPERT_FEATURES,
        this._featuresOpen,
        () => {
          this._featuresOpen = !this._featuresOpen;
        }
      )}
    `;
  }

  private _renderFeaturesBox(
    labelKey: string,
    features: FeatureItem[],
    open: boolean,
    onToggle: () => void
  ) {
    return html`
      <div class="expert-features">
        ${renderDisclosure({
          open,
          onToggle,
          localize: this._localize,
          labelKey,
          variant: "heading",
          body: () => renderFeatureList(this._localize, features),
        })}
      </div>
    `;
  }

  private _onChange(e: Event) {
    const theme = (e.target as HTMLSelectElement).value;
    this._theme = theme;
    fireEvent(this, "set-theme", theme);
  }

  private _onToggleExpertMode() {
    fireEvent(this, "set-expert-mode", !this._expertMode);
  }

  private _onToggleRemoteCompute() {
    fireEvent(this, "set-remote-compute-only", !this._remoteComputeOnly);
  }

  private _onToggleHideDeviceBuilder() {
    fireEvent(this, "set-hide-device-builder", !this._hideDeviceBuilder);
  }

  private _onToggleVersionHistory() {
    fireEvent(this, "set-version-history-enabled", !this._versionHistoryEnabled);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-appearance": ESPHomeSettingsAppearance;
  }
}
