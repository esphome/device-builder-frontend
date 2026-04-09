import { consume } from "@lit/context";
import {
  mdiCog,
  mdiKeyVariant,
  mdiPalette,
  mdiSquareEditOutline,
  mdiUpdate,
} from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import toast from "sonner-js";
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
  cog: mdiCog,
  "key-variant": mdiKeyVariant,
  palette: mdiPalette,
  "square-edit-outline": mdiSquareEditOutline,
  update: mdiUpdate,
});

@customElement("esphome-header-actions")
export class ESPHomeHeaderActions extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: darkModeContext, subscribe: true })
  @state()
  private _darkMode = false;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state()
  private _confirmUpdateOpen = false;

  @state()
  private _settingsOpen = false;

  @state()
  private _settingsTab = "appearance";

  @state()
  private _editorLayout = "both";

  @state()
  private _updating = false;

  @state()
  private _path = window.location.pathname;

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
        transition:
          opacity 0.12s,
          background 0.12s;
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

      .header-actions-separator {
        width: 1px;
        height: 20px;
        background: color-mix(in srgb, var(--esphome-on-primary), transparent 70%);
        flex-shrink: 0;
        margin: 0 4px;
      }

      /* ─── Update all dialog ─── */

      wa-dialog {
        --width: 400px;
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

      .dialog-body {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-l);
      }

      .dialog-body p {
        margin: 0;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
      }

      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
      }

      /* ─── Settings dialog ─── */

      wa-dialog.settings-dialog {
        --width: 560px;
      }

      .settings-layout {
        display: grid;
        grid-template-columns: 150px 1fr;
        gap: 0;
        min-height: 280px;
      }

      .settings-sidebar {
        display: flex;
        flex-direction: column;
        gap: 2px;
        border-right: 1px solid var(--wa-color-surface-border);
        padding-right: var(--wa-space-m);
      }

      .settings-tab {
        display: flex;
        align-items: center;
        gap: var(--wa-space-xs);
        padding: var(--wa-space-xs) var(--wa-space-s);
        border: none;
        background: none;
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        font-family: inherit;
        color: var(--wa-color-text-quiet);
        text-align: left;
      }

      .settings-tab:hover {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
      }

      .settings-tab--active {
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        color: var(--esphome-primary);
      }

      .settings-tab wa-icon {
        font-size: 16px;
      }

      .settings-content {
        padding-left: var(--wa-space-l);
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-l);
      }

      .settings-content h3 {
        margin: 0;
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
      }

      .setting-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-m);
      }

      .setting-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .setting-label {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-semibold);
        color: var(--wa-color-text-normal);
      }

      .setting-desc {
        font-size: var(--wa-font-size-2xs);
        color: var(--wa-color-text-quiet);
      }

      .setting-row wa-select {
        min-width: 140px;
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
                @click=${this._openConfirmUpdate}
                title=${this._localize("layout.update_all")}
              >
                <wa-icon library="mdi" name="update"></wa-icon>
                ${this._localize("layout.update_all")}
              </button>
            `
          : ""}
        <div class="header-actions-separator"></div>
        <button
          class="hdr-btn hdr-btn--icon-only"
          @click=${this._openSettings}
          title=${this._localize("layout.settings")}
        >
          <wa-icon library="mdi" name="cog"></wa-icon>
        </button>
      </div>

      <wa-dialog
        label=${this._localize("layout.update_all_title")}
        ?open=${this._confirmUpdateOpen}
        @wa-after-hide=${() => {
          this._confirmUpdateOpen = false;
        }}
        light-dismiss
      >
        <div class="dialog-body">
          <p>${this._localize("layout.update_all_desc")}</p>
          <div class="dialog-actions">
            <wa-button
              variant="secondary"
              size="small"
              @click=${() => {
                this._confirmUpdateOpen = false;
              }}
            >
              ${this._localize("layout.cancel")}
            </wa-button>
            <wa-button
              variant="primary"
              size="small"
              ?disabled=${this._updating}
              @click=${this._confirmUpdateAll}
            >
              ${this._updating
                ? this._localize("layout.updating")
                : this._localize("layout.update_all_confirm")}
            </wa-button>
          </div>
        </div>
      </wa-dialog>

      <wa-dialog
        class="settings-dialog"
        label=${this._localize("layout.settings")}
        ?open=${this._settingsOpen}
        @wa-after-hide=${() => { this._settingsOpen = false; }}
        light-dismiss
      >
        <div class="settings-layout">
          <nav class="settings-sidebar">
            <button
              class="settings-tab ${this._settingsTab === "appearance" ? "settings-tab--active" : ""}"
              @click=${() => { this._settingsTab = "appearance"; }}
            >
              <wa-icon library="mdi" name="palette"></wa-icon>
              ${this._localize("settings.appearance")}
            </button>
            <button
              class="settings-tab ${this._settingsTab === "editor" ? "settings-tab--active" : ""}"
              @click=${() => { this._settingsTab = "editor"; }}
            >
              <wa-icon library="mdi" name="square-edit-outline"></wa-icon>
              ${this._localize("settings.editor")}
            </button>
          </nav>
          <div class="settings-content">
            ${this._settingsTab === "appearance" ? this._renderAppearanceSettings() : nothing}
            ${this._settingsTab === "editor" ? this._renderEditorSettings() : nothing}
          </div>
        </div>
      </wa-dialog>
    `;
  }

  private _renderAppearanceSettings() {
    return html`
      <h3>${this._localize("settings.appearance")}</h3>
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">${this._localize("settings.dark_mode")}</span>
          <span class="setting-desc">${this._localize("settings.dark_mode_desc")}</span>
        </div>
        <wa-switch
          ?checked=${this._darkMode}
          @change=${this._toggleDarkMode}
        ></wa-switch>
      </div>
    `;
  }

  private _renderEditorSettings() {
    return html`
      <h3>${this._localize("settings.editor")}</h3>
      <div class="setting-row">
        <div class="setting-info">
          <span class="setting-label">${this._localize("settings.editor_layout")}</span>
          <span class="setting-desc">${this._localize("settings.editor_layout_desc")}</span>
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
    `;
  }

  private _openSecrets() {
    window.history.pushState({}, "", "/secrets");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  private _openConfirmUpdate() {
    this._confirmUpdateOpen = true;
  }

  private async _confirmUpdateAll() {
    this._updating = true;
    try {
      // TODO: Update all is not yet supported by the WebSocket backend
      this._confirmUpdateOpen = false;
      toast.info("Update all is not yet available", { richColors: true });
    } catch {
      toast.error(this._localize("layout.update_all_error"), { richColors: true });
    } finally {
      this._updating = false;
    }
  }

  private async _openSettings() {
    try {
      const prefs = await this._api.getPreferences();
      this._editorLayout = prefs.editor_layout ?? "both";
    } catch {
      // Use defaults
    }
    this._settingsOpen = true;
  }

  private _toggleDarkMode() {
    this.dispatchEvent(
      new CustomEvent("toggle-dark-mode", { bubbles: true, composed: true })
    );
  }

  private _setEditorLayout(layout: string) {
    this._editorLayout = layout;
    this._api.updatePreferences({ editor_layout: layout as "both" | "left" | "right" }).catch(() => {});
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-header-actions": ESPHomeHeaderActions;
  }
}
