import { consume } from "@lit/context";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { localizeContext, yamlDiffButtonContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { settingsRowStyles, settingsSharedStyles } from "./shared-styles.js";

@customElement("esphome-settings-editor")
export class ESPHomeSettingsEditor extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: yamlDiffButtonContext, subscribe: true })
  @state()
  private _yamlDiffButton = false;

  static styles = [espHomeStyles, settingsSharedStyles, settingsRowStyles];

  protected render() {
    // aria-checked uses the string-attribute form, not Lit's
    // ?aria-checked= boolean binding — the boolean binding omits
    // the attribute on false, breaking the [aria-checked="false"]
    // CSS state and the screen-reader announcement.
    return html`
      <div class="row">
        <div class="row-label">
          <span id="yaml-diff-title" class="row-title">
            ${this._localize("settings.show_yaml_diff_button")}
          </span>
          <span class="row-desc">
            ${this._localize("settings.show_yaml_diff_button_desc")}
          </span>
        </div>
        <button
          class="toggle"
          role="switch"
          aria-labelledby="yaml-diff-title"
          aria-checked=${this._yamlDiffButton}
          @click=${this._onToggle}
        ></button>
      </div>
    `;
  }

  private _onToggle() {
    this.dispatchEvent(
      new CustomEvent("set-yaml-diff-button", {
        detail: !this._yamlDiffButton,
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-editor": ESPHomeSettingsEditor;
  }
}
