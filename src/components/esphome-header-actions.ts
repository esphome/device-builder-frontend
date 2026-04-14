import { consume } from "@lit/context";
import { mdiCog, mdiKeyVariant, mdiUpdate } from "@mdi/js";
import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./settings-dialog.js";
import type { ESPHomeSettingsDialog } from "./settings-dialog.js";

registerMdiIcons({
  cog: mdiCog,
  "key-variant": mdiKeyVariant,
  update: mdiUpdate,
});

@customElement("esphome-header-actions")
export class ESPHomeHeaderActions extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state()
  private _settingsOpen = false;

  @state()
  private _path = window.location.pathname;

  @query("esphome-settings-dialog")
  private _settingsDialog!: ESPHomeSettingsDialog;

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

      .header-actions {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .hdr-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: none;
        background: none;
        color: var(--esphome-on-primary);
        cursor: pointer;
        padding: 6px 10px;
        border-radius: var(--wa-border-radius-m);
        opacity: 0.85;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        white-space: nowrap;
        transition: opacity 0.12s, background 0.12s;
      }

      .hdr-btn:hover {
        opacity: 1;
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 85%);
      }

      .hdr-btn wa-icon {
        font-size: 18px;
      }

      .hdr-btn--icon-only {
        padding: 6px;
      }

      .separator {
        width: 1px;
        height: 20px;
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 70%);
        flex-shrink: 0;
        margin: 0 4px;
      }
    `,
  ];

  protected render() {
    return html`
      <div class="header-actions">
        <button
          class="hdr-btn"
          @click=${this._openSecrets}
          title=${this._localize("layout.secrets")}
        >
          <wa-icon library="mdi" name="key-variant"></wa-icon>
          ${this._localize("layout.secrets")}
        </button>
        ${this._path === "/"
          ? html`
              <button
                class="hdr-btn"
                @click=${() => window.dispatchEvent(new CustomEvent("esphome-enter-select-mode"))}
                title=${this._localize("layout.update_all")}
              >
                <wa-icon library="mdi" name="update"></wa-icon>
                ${this._localize("layout.update_all")}
              </button>
            `
          : ""}
        <div class="separator"></div>
        <button
          class="hdr-btn hdr-btn--icon-only"
          @click=${this._openSettings}
          title=${this._localize("layout.settings")}
        >
          <wa-icon library="mdi" name="cog"></wa-icon>
        </button>
      </div>

      <esphome-settings-dialog
        ?open=${this._settingsOpen}
        @close=${() => { this._settingsOpen = false; }}
        @toggle-dark-mode=${this._forwardDarkModeToggle}
      ></esphome-settings-dialog>
    `;
  }

  private _openSecrets() {
    window.history.pushState({}, "", "/secrets");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  private async _openSettings() {
    await this._settingsDialog.loadPreferences();
    this._settingsOpen = true;
  }

  private _forwardDarkModeToggle() {
    this.dispatchEvent(
      new CustomEvent("toggle-dark-mode", { bubbles: true, composed: true }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-header-actions": ESPHomeHeaderActions;
  }
}
