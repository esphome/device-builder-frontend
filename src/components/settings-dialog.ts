import { consume } from "@lit/context";
import { mdiPaletteOutline, mdiTranslate, mdiVectorDifference } from "@mdi/js";
import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { LocalizeFunc, SupportedLocale } from "../common/localize.js";
import { readStoredLocale } from "../common/localize.js";

/** Sentinel meaning "follow browser locale" (no explicit override). */
type LanguageChoice = SupportedLocale | "system";
import { localizeContext, yamlDiffButtonContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/option/option.js";
import "@home-assistant/webawesome/dist/components/select/select.js";

registerMdiIcons({
  "palette-outline": mdiPaletteOutline,
  translate: mdiTranslate,
  "vector-difference": mdiVectorDifference,
});

type Section = "appearance" | "language" | "editor";

interface SectionDef {
  id: Section;
  icon: string;
  labelKey: string;
}

const SECTIONS: SectionDef[] = [
  { id: "appearance", icon: "palette-outline", labelKey: "settings.appearance" },
  { id: "language", icon: "translate", labelKey: "settings.language" },
  { id: "editor", icon: "vector-difference", labelKey: "layout.editor" },
];

const LANGUAGES: { value: LanguageChoice; labelKey: string }[] = [
  { value: "system", labelKey: "settings.language_system" },
  { value: "en", labelKey: "settings.language_en" },
  { value: "fr", labelKey: "settings.language_fr" },
  { value: "nl", labelKey: "settings.language_nl" },
];

@customElement("esphome-settings-dialog")
export class ESPHomeSettingsDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: yamlDiffButtonContext, subscribe: true })
  @state()
  private _yamlDiffButton = false;

  @state()
  private _section: Section = "appearance";

  @state()
  private _theme: string = localStorage.getItem("esphome-theme") ?? "system";

  @state()
  private _language: LanguageChoice = readStoredLocale() ?? "system";

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  open() {
    this._theme = localStorage.getItem("esphome-theme") ?? "system";
    this._language = readStoredLocale() ?? "system";
    this._section = "appearance";
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: min(800px, 95vw);
      }

      wa-dialog::part(header) {
        background: var(--esphome-primary);
        padding: 0 var(--wa-space-m);
        height: 40px;
        box-sizing: border-box;
      }

      wa-dialog::part(title) {
        color: var(--esphome-on-primary);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
        padding: 0;
        min-width: unset;
        min-height: unset;
        color: var(--esphome-on-primary);
        cursor: pointer;
      }

      wa-dialog::part(footer) {
        display: none;
      }

      wa-dialog::part(body) {
        padding: 0;
      }

      .layout {
        display: flex;
        height: min(500px, 70vh);
      }

      .sidebar {
        width: 220px;
        flex-shrink: 0;
        background: var(--wa-color-surface-default);
        border-right: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        padding: var(--wa-space-m) var(--wa-space-xs);
        overflow-y: auto;
      }

      .nav {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .nav-item {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding: 8px var(--wa-space-s);
        border: none;
        background: transparent;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-family: inherit;
        color: var(--wa-color-text-normal);
        cursor: pointer;
        text-align: left;
        transition:
          background 0.12s,
          color 0.12s,
          text-shadow 0.12s;
      }

      .nav-item:hover,
      .nav-item--active {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        /* Fake bold via text-shadow so the layout doesn't reflow on hover —
           changing real font-weight widens the text, the cursor falls off the
           element, the hover drops, and you get the flicker. */
        text-shadow:
          0.4px 0 0 currentColor,
          -0.4px 0 0 currentColor;
      }

      .nav-item:hover wa-icon,
      .nav-item--active wa-icon {
        color: var(--wa-color-text-normal);
      }

      .nav-item wa-icon {
        font-size: 18px;
        color: var(--wa-color-text-quiet);
        transition: color 0.12s;
      }

      .content {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-width: 0;
        overflow: hidden;
      }

      .content-body {
        flex: 1;
        padding: 0 var(--wa-space-l);
        padding-bottom: var(--wa-space-l);
        overflow-y: auto;
      }

      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-m);
        padding: var(--wa-space-m) 0;
        border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .row:last-child {
        border-bottom: none;
      }

      .row-label {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .row-title {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .row-desc {
        font-size: var(--wa-font-size-xs);
        color: var(--wa-color-text-quiet);
      }

      wa-select {
        min-width: 180px;
      }

      .toggle {
        position: relative;
        width: 40px;
        height: 22px;
        border: none;
        border-radius: 11px;
        background: var(--wa-color-surface-border);
        cursor: pointer;
        transition: background 0.15s;
        padding: 0;
        flex-shrink: 0;
      }

      .toggle[aria-checked="true"] {
        background: var(--esphome-primary);
      }

      .toggle::after {
        content: "";
        position: absolute;
        top: 3px;
        left: 3px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: white;
        transition: transform 0.15s;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      }

      .toggle[aria-checked="true"]::after {
        transform: translateX(18px);
      }

      @media (max-width: 700px) {
        .layout {
          flex-direction: column;
          height: auto;
        }
        .sidebar {
          width: auto;
          border-right: none;
          border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        }
        .nav {
          flex-direction: row;
          flex-wrap: wrap;
        }
      }
    `,
  ];

  protected render() {
    const current = SECTIONS.find((s) => s.id === this._section) ?? SECTIONS[0];

    return html`
      <wa-dialog
        light-dismiss
        label="${this._localize("settings.title")} - ${this._localize(current.labelKey)}"
      >
        <div class="layout">
          <aside class="sidebar">
            <nav class="nav">
              ${SECTIONS.map(
                (s) => html`
                  <button
                    class="nav-item ${s.id === this._section ? "nav-item--active" : ""}"
                    @click=${() => (this._section = s.id)}
                  >
                    <wa-icon library="mdi" name=${s.icon}></wa-icon>
                    <span>${this._localize(s.labelKey)}</span>
                  </button>
                `
              )}
            </nav>
          </aside>
          <main class="content">
            <div class="content-body">${this._renderSection()}</div>
          </main>
        </div>
      </wa-dialog>
    `;
  }

  private _renderSection() {
    switch (this._section) {
      case "appearance":
        return this._renderAppearance();
      case "language":
        return this._renderLanguage();
      case "editor":
        return this._renderEditor();
    }
  }

  private _renderAppearance() {
    return html`
      <div class="row">
        <div class="row-label">
          <span class="row-title">${this._localize("layout.theme")}</span>
          <span class="row-desc">${this._localize("settings.theme_desc")}</span>
        </div>
        <wa-select value=${this._theme} @change=${this._onThemeChange}>
          <wa-option value="light">${this._localize("layout.theme_light")}</wa-option>
          <wa-option value="dark">${this._localize("layout.theme_dark")}</wa-option>
          <wa-option value="system">${this._localize("layout.theme_system")}</wa-option>
        </wa-select>
      </div>
    `;
  }

  private _renderLanguage() {
    return html`
      <div class="row">
        <div class="row-label">
          <span class="row-title">${this._localize("settings.language")}</span>
          <span class="row-desc">${this._localize("settings.language_desc")}</span>
        </div>
        <wa-select value=${this._language} @change=${this._onLanguageChange}>
          ${LANGUAGES.map(
            (l) => html`
              <wa-option value=${l.value}>${this._localize(l.labelKey)}</wa-option>
            `
          )}
        </wa-select>
      </div>
    `;
  }

  private _renderEditor() {
    return html`
      <div class="row">
        <div class="row-label">
          <span class="row-title">
            ${this._localize("settings.show_yaml_diff_button")}
          </span>
          <span class="row-desc">
            ${this._localize("settings.show_yaml_diff_button_desc")}
          </span>
        </div>
        <button
          class="toggle"
          role="switch"
          aria-checked=${this._yamlDiffButton}
          @click=${this._onToggleDiff}
        ></button>
      </div>
    `;
  }

  private _onThemeChange(e: Event) {
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

  private _onLanguageChange(e: Event) {
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

  private _onToggleDiff() {
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
    "esphome-settings-dialog": ESPHomeSettingsDialog;
  }
}
