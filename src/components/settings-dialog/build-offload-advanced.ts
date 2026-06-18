import { consume } from "@lit/context";
import { mdiChevronDown, mdiChevronUp } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import {
  localizeContext,
  offloaderIncludeLocalInPoolContext,
} from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { settingsRowStyles, settingsSharedStyles } from "./shared-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "chevron-down": mdiChevronDown,
  "chevron-up": mdiChevronUp,
});

/**
 * "Advanced options" disclosure for the Build offload section.
 *
 * Collapsed by default so the include-local-in-pool toggle stays
 * out of the way for the common single-server setup. Owns its own
 * context + expand state so the parent section stays under the
 * file-size cap; dispatches a bubbling+composed
 * ``set-offloader-include-local`` event that app-shell handles.
 */
@customElement("esphome-settings-build-offload-advanced")
export class ESPHomeSettingsBuildOffloadAdvanced extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: offloaderIncludeLocalInPoolContext, subscribe: true })
  @state()
  private _includeLocalInPool: boolean | null = null;

  @state()
  private _expanded = false;

  static styles = [
    espHomeStyles,
    settingsSharedStyles,
    settingsRowStyles,
    css`
      .advanced-toggle {
        display: inline-flex;
        align-items: center;
        margin-top: var(--wa-space-m);
        padding: 0;
        background: none;
        border: none;
        font-family: inherit;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--esphome-primary);
        cursor: pointer;
        text-decoration: underline;
        text-underline-offset: 2px;
      }
      .advanced-toggle__chevron {
        font-size: 16px;
        text-decoration: none;
      }
      .advanced-toggle:focus-visible {
        outline: 2px solid var(--esphome-primary);
        outline-offset: 2px;
      }
      .advanced-panel {
        margin-top: var(--wa-space-s);
      }
    `,
  ];

  protected render() {
    return html`
      <button
        type="button"
        class="advanced-toggle"
        aria-expanded=${this._expanded ? "true" : "false"}
        aria-controls=${this._expanded ? "offload-advanced-panel" : nothing}
        @click=${this._onToggleAdvanced}
      >
        ${this._localize("settings.offloader_advanced_toggle")}
        <wa-icon
          class="advanced-toggle__chevron"
          library="mdi"
          name=${this._expanded ? "chevron-up" : "chevron-down"}
          aria-hidden="true"
        ></wa-icon>
      </button>
      ${this._expanded
        ? html`
            <div id="offload-advanced-panel" class="advanced-panel">
              ${this._renderIncludeLocalToggle()}
            </div>
          `
        : nothing}
    `;
  }

  private _renderIncludeLocalToggle() {
    if (this._includeLocalInPool === null) {
      return html`
        <div class="row" role="status">
          <div class="row-label">
            <span class="row-title">
              ${this._localize("settings.offloader_include_local")}
            </span>
            <span class="row-desc">
              ${this._localize("settings.offloader_include_local_loading")}
            </span>
          </div>
        </div>
      `;
    }
    return html`
      <div class="row">
        <div class="row-label">
          <span id="offloader-include-local-title" class="row-title">
            ${this._localize("settings.offloader_include_local")}
          </span>
          <span class="row-desc">
            ${this._localize("settings.offloader_include_local_desc")}
          </span>
        </div>
        <button
          class="toggle"
          role="switch"
          aria-labelledby="offloader-include-local-title"
          aria-checked=${this._includeLocalInPool}
          @click=${this._onToggleIncludeLocal}
        ></button>
      </div>
    `;
  }

  private _onToggleAdvanced = () => {
    this._expanded = !this._expanded;
  };

  private _onToggleIncludeLocal = () => {
    if (this._includeLocalInPool === null) return;
    this.dispatchEvent(
      new CustomEvent("set-offloader-include-local", {
        detail: !this._includeLocalInPool,
        bubbles: true,
        composed: true,
      })
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-build-offload-advanced": ESPHomeSettingsBuildOffloadAdvanced;
  }
}
