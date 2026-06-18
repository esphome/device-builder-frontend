import { consume } from "@lit/context";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import {
  localizeContext,
  offloaderIncludeLocalInPoolContext,
} from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { settingsRowStyles, settingsSharedStyles } from "./shared-styles.js";

/**
 * "Include local in build pool" toggle for the Build offload section.
 *
 * Shown inline to every user (the setting is buried enough in the section
 * that gating it would hide it from everyone who'd use it). Its own
 * component so the parent section stays under the file-size cap; dispatches
 * a bubbling+composed ``set-offloader-include-local`` event app-shell handles.
 */
@customElement("esphome-settings-build-offload-advanced")
export class ESPHomeSettingsBuildOffloadAdvanced extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: offloaderIncludeLocalInPoolContext, subscribe: true })
  @state()
  private _includeLocalInPool: boolean | null = null;

  static styles = [espHomeStyles, settingsSharedStyles, settingsRowStyles];

  protected render() {
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
