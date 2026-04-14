import { consume } from "@lit/context";
import { mdiPalette, mdiSquareEditOutline } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, darkModeContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/switch/switch.js";
import "@home-assistant/webawesome/dist/components/select/select.js";
import "@home-assistant/webawesome/dist/components/option/option.js";

registerMdiIcons({
  palette: mdiPalette,
  "square-edit-outline": mdiSquareEditOutline,
});

@customElement("esphome-settings-dialog")
export class ESPHomeSettingsDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = false;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property({ type: Boolean })
  open = false;

  @state()
  private _tab = "appearance";

  @state()
  private _editorLayout = "both";

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: 440px;
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

      wa-dialog::part(body) {
        padding: var(--wa-space-l) var(--wa-space-xl);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .layout {
        display: flex;
        flex-direction: column;
        gap: 0;
      }

      .tabs {
        display: flex;
        gap: 0;
        border-bottom: 1px solid var(--wa-color-surface-border);
        margin-bottom: var(--wa-space-m);
      }

      .tab {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: var(--wa-space-s) var(--wa-space-m);
        border: none;
        background: none;
        cursor: pointer;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-semibold);
        font-family: inherit;
        color: var(--wa-color-text-quiet);
        position: relative;
        transition: color 0.12s;
      }

      .tab:hover {
        color: var(--wa-color-text-normal);
      }

      .tab--active {
        color: var(--esphome-primary);
      }

      .tab--active::after {
        content: "";
        position: absolute;
        bottom: -1px;
        left: var(--wa-space-s);
        right: var(--wa-space-s);
        height: 2px;
        background: var(--esphome-primary);
        border-radius: 2px 2px 0 0;
      }

      .tab wa-icon {
        font-size: 15px;
      }

      .content {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
      }

      .group {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        background: var(--wa-color-surface-raised);
      }

      .row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-m);
      }

      .info {
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex: 1;
        min-width: 0;
      }

      .label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .desc {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
        line-height: 1.4;
      }

      .row wa-select {
        min-width: 140px;
      }
    `,
  ];

  public async loadPreferences() {
    try {
      const prefs = await this._api.getPreferences();
      this._editorLayout = prefs.editor_layout ?? "both";
    } catch {
      // Use defaults
    }
  }

  protected render() {
    return html`
      <wa-dialog
        label=${this._localize("layout.settings")}
        ?open=${this.open}
        @wa-after-hide=${this._onClose}
        light-dismiss
      >
        <div class="layout">
          <div class="tabs">
            <button
              class="tab ${this._tab === "appearance" ? "tab--active" : ""}"
              @click=${() => { this._tab = "appearance"; }}
            >
              <wa-icon library="mdi" name="palette"></wa-icon>
              ${this._localize("settings.appearance")}
            </button>
            <button
              class="tab ${this._tab === "editor" ? "tab--active" : ""}"
              @click=${() => { this._tab = "editor"; }}
            >
              <wa-icon library="mdi" name="square-edit-outline"></wa-icon>
              ${this._localize("settings.editor")}
            </button>
          </div>
          <div class="content">
            ${this._tab === "appearance" ? this._renderAppearance() : nothing}
            ${this._tab === "editor" ? this._renderEditor() : nothing}
          </div>
        </div>
      </wa-dialog>
    `;
  }

  private _renderAppearance() {
    return html`
      <div class="group">
        <div class="row">
          <div class="info">
            <span class="label">${this._localize("settings.dark_mode")}</span>
            <span class="desc">${this._localize("settings.dark_mode_desc")}</span>
          </div>
          <wa-switch
            ?checked=${this._darkMode}
            @change=${this._toggleDarkMode}
          ></wa-switch>
        </div>
      </div>
    `;
  }

  private _renderEditor() {
    return html`
      <div class="group">
        <div class="row">
          <div class="info">
            <span class="label">${this._localize("settings.editor_layout")}</span>
            <span class="desc">${this._localize("settings.editor_layout_desc")}</span>
          </div>
          <wa-select
            .value=${this._editorLayout}
            @change=${(e: Event) => this._setEditorLayout((e.target as HTMLSelectElement).value)}
          >
            <wa-option value="both">${this._localize("settings.layout_split")}</wa-option>
            <wa-option value="left">${this._localize("settings.layout_visual")}</wa-option>
            <wa-option value="right">${this._localize("settings.layout_yaml")}</wa-option>
          </wa-select>
        </div>
      </div>
    `;
  }

  private _onClose() {
    this.dispatchEvent(
      new CustomEvent("close", { bubbles: true, composed: true }),
    );
  }

  private _toggleDarkMode() {
    this.dispatchEvent(
      new CustomEvent("toggle-dark-mode", { bubbles: true, composed: true }),
    );
  }

  private _setEditorLayout(layout: string) {
    this._editorLayout = layout;
    this._api
      .updatePreferences({ editor_layout: layout as "both" | "left" | "right" })
      .catch(() => {});
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-dialog": ESPHomeSettingsDialog;
  }
}
