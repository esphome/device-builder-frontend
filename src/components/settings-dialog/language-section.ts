import { consume } from "@lit/context";
import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../../common/localize.js";
import { readStoredLocale } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { LANGUAGES, type LanguageChoice } from "./types.js";
import { settingsRowStyles, settingsSharedStyles } from "./shared-styles.js";

import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

@customElement("esphome-settings-language")
export class ESPHomeSettingsLanguage extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state()
  private _language: LanguageChoice = readStoredLocale() ?? "system";

  static styles = [espHomeStyles, settingsSharedStyles, settingsRowStyles];

  protected render() {
    return html`
      <div class="row">
        <div class="row-label">
          <span class="row-title">${this._localize("settings.language")}</span>
          <span class="row-desc">${this._localize("settings.language_desc")}</span>
        </div>
        <wa-select value=${this._language} @change=${this._onChange}>
          ${LANGUAGES.map(
            (l) => html`
              <wa-option value=${l.value}>${this._localize(l.labelKey)}</wa-option>
            `,
          )}
        </wa-select>
      </div>
    `;
  }

  private _onChange(e: Event) {
    const lang = (e.target as HTMLSelectElement).value as LanguageChoice;
    this._language = lang;
    this.dispatchEvent(
      new CustomEvent("set-language", {
        detail: lang,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-language": ESPHomeSettingsLanguage;
  }
}
