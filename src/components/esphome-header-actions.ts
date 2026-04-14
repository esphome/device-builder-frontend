import { consume } from "@lit/context";
import {
  mdiDotsVertical,
  mdiKeyVariant,
  mdiUpdate,
  mdiWeatherNight,
  mdiWeatherSunny,
  mdiThemeLightDark,
} from "@mdi/js";
import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { darkModeContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dropdown-item/dropdown-item.js";
import "@home-assistant/webawesome/dist/components/dropdown/dropdown.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "dots-vertical": mdiDotsVertical,
  "key-variant": mdiKeyVariant,
  update: mdiUpdate,
  "weather-night": mdiWeatherNight,
  "weather-sunny": mdiWeatherSunny,
  "theme-light-dark": mdiThemeLightDark,
});

@customElement("esphome-header-actions")
export class ESPHomeHeaderActions extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = false;

  @state()
  private _path = window.location.pathname;

  @state()
  private _themeOpen = false;

  private get _currentTheme(): string {
    return localStorage.getItem("esphome-theme") ?? "system";
  }

  private _onPopState = () => {
    this._path = window.location.pathname;
  };

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("popstate", this._onPopState);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("popstate", this._onPopState);
  }

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: contents;
      }

      .menu-btn {
        display: inline-flex;
        align-items: center;
        border: none;
        background: none;
        color: var(--esphome-on-primary);
        cursor: pointer;
        padding: 6px;
        border-radius: var(--wa-border-radius-m);
        opacity: 0.85;
        transition: opacity 0.12s, background 0.12s;
      }

      .menu-btn:hover {
        opacity: 1;
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
      }

      .menu-btn wa-icon {
        font-size: 20px;
      }

      .theme-submenu {
        display: flex;
        flex-direction: column;
        padding: var(--wa-space-2xs) 0;
      }

      .theme-label {
        padding: var(--wa-space-2xs) var(--wa-space-m);
        font-size: var(--wa-font-size-2xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
    `,
  ];

  protected render() {
    const theme = this._currentTheme;

    return html`
      <wa-dropdown placement="bottom-end" distance="4">
        <button slot="trigger" class="menu-btn">
          <wa-icon library="mdi" name="dots-vertical"></wa-icon>
        </button>

        ${this._path === "/"
          ? html`
              <wa-dropdown-item @click=${this._openUpdateAll}>
                <wa-icon slot="icon" library="mdi" name="update"></wa-icon>
                ${this._localize("layout.update_all")}
              </wa-dropdown-item>
            `
          : ""}

        <wa-dropdown-item @click=${this._openSecrets}>
          <wa-icon slot="icon" library="mdi" name="key-variant"></wa-icon>
          ${this._localize("layout.secrets")}
        </wa-dropdown-item>

        <div class="theme-submenu">
          <span class="theme-label">${this._localize("layout.theme")}</span>
          <wa-dropdown-item
            ?checked=${theme === "light"}
            @click=${() => this._setTheme("light")}
          >
            <wa-icon slot="icon" library="mdi" name="weather-sunny"></wa-icon>
            ${this._localize("layout.theme_light")}
          </wa-dropdown-item>
          <wa-dropdown-item
            ?checked=${theme === "dark"}
            @click=${() => this._setTheme("dark")}
          >
            <wa-icon slot="icon" library="mdi" name="weather-night"></wa-icon>
            ${this._localize("layout.theme_dark")}
          </wa-dropdown-item>
          <wa-dropdown-item
            ?checked=${theme === "system"}
            @click=${() => this._setTheme("system")}
          >
            <wa-icon slot="icon" library="mdi" name="theme-light-dark"></wa-icon>
            ${this._localize("layout.theme_system")}
          </wa-dropdown-item>
        </div>
      </wa-dropdown>
    `;
  }

  private _openSecrets() {
    window.history.pushState({}, "", "/secrets");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  private _openUpdateAll() {
    window.dispatchEvent(new CustomEvent("esphome-enter-select-mode"));
  }

  private _setTheme(theme: string) {
    this.dispatchEvent(
      new CustomEvent("set-theme", {
        detail: theme,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-header-actions": ESPHomeHeaderActions;
  }
}
