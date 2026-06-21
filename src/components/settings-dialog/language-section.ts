import { consume } from "@lit/context";
import { mdiOpenInNew } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";

import type {
  LanguageChoice,
  LanguageOption,
  LocalizeFunc,
} from "../../common/localize.js";
import { LANGUAGES, languageLabel, readStoredLocale } from "../../common/localize.js";
import { localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { registerMdiIcons } from "../../util/register-icons.js";
import { settingsRowStyles, settingsSharedStyles } from "./shared-styles.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

registerMdiIcons({ "open-in-new": mdiOpenInNew });

// The ESPHome translations guide, which links on to Lokalise; see issue #888.
const TRANSLATIONS_GUIDE_URL = "https://developers.esphome.io/contributing/translations/";

@customElement("esphome-settings-language")
export class ESPHomeSettingsLanguage extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state()
  private _language: LanguageChoice = readStoredLocale() ?? "system";

  static styles = [
    espHomeStyles,
    inputStyles,
    settingsSharedStyles,
    settingsRowStyles,
    css`
      .language-help,
      .language-note {
        margin: var(--wa-space-xs) 0 0;
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.4;
      }
      .language-help-link {
        color: var(--esphome-primary);
        text-decoration: none;
        white-space: nowrap;
      }
      .language-help-link:hover {
        text-decoration: underline;
      }
      .language-help-link wa-icon {
        font-size: 1em;
        vertical-align: -0.15em;
      }
      .language-completeness {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  protected render() {
    return html`
      <div class="row row--stacked">
        <div class="row-label">
          <span class="row-title">${this._localize("settings.language")}</span>
          <span class="row-desc">${this._localize("settings.language_desc")}</span>
        </div>
        <wa-select value=${this._language} @change=${this._onChange}>
          ${LANGUAGES.map(
            (l) => html`
              <wa-option value=${l.value}
                >${l.flag}
                ${languageLabel(l, this._localize)}${this._renderCompleteness(
                  l
                )}</wa-option
              >
            `
          )}
        </wa-select>
        <p class="language-note">
          ${this._localize("settings.language_completeness_note")}
        </p>
        <p class="language-help">
          <span aria-hidden="true">💡</span>
          ${this._localize("settings.language_help")}
          <a
            class="language-help-link"
            href=${TRANSLATIONS_GUIDE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            ${this._localize("settings.language_help_link")}
            <wa-icon library="mdi" name="open-in-new"></wa-icon>
          </a>
        </p>
      </div>
    `;
  }

  // A muted "{n}% translated" badge in the option's trailing slot, shown only
  // for locales that aren't fully translated. English and any complete locale
  // (completeness === 100) and the "system" option (completeness undefined)
  // render no badge, so the badge reads as "this language still needs work".
  private _renderCompleteness(option: LanguageOption) {
    if (option.completeness === undefined || option.completeness >= 100) {
      return nothing;
    }
    const label = this._localize("settings.language_completeness", {
      percent: option.completeness,
    });
    return html`<span
      slot="end"
      class="language-completeness"
      title=${label}
      aria-label=${label}
      >${option.completeness}%</span
    >`;
  }

  private _onChange(e: Event) {
    const lang = (e.target as HTMLSelectElement).value as LanguageChoice;
    this._language = lang;
    this.dispatchEvent(
      new CustomEvent("set-language", {
        detail: lang,
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-language": ESPHomeSettingsLanguage;
  }
}
