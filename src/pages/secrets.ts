import { consume } from "@lit/context";
import { mdiArrowLeft, mdiContentSave } from "@mdi/js";
import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import toast from "sonner-js";
import type { ESPHomeAPI } from "../api/index.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/button/button.js";
import "@home-assistant/webawesome/dist/components/divider/divider.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";
import "../components/yaml-editor.js";

registerMdiIcons({
  "arrow-left": mdiArrowLeft,
  "content-save": mdiContentSave,
});

const SECRETS_FILE = "secrets.yaml";

@customElement("esphome-page-secrets")
export class ESPHomePageSecrets extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @state()
  private _yaml = "";

  @state()
  private _saving = false;

  @state()
  private _loaded = false;

  async connectedCallback() {
    super.connectedCallback();
    try {
      this._yaml = await this._api.getConfig(SECRETS_FILE);
    } catch {
      this._yaml =
        '# ESPHome Secrets\n# Define sensitive values here and reference them with !secret <key>\n\nwifi_ssid: "your-ssid"\nwifi_password: "your-password"\napi_encryption_key: "your-key"\n';
    }
    this._loaded = true;
  }

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: calc(100vh - var(--esphome-header-height));
        box-sizing: border-box;
      }

      .page {
        flex: 1;
        display: flex;
        flex-direction: column;
        padding: var(--wa-space-l);
        gap: var(--wa-space-m);
        overflow: hidden;
      }

      .page-header {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
        flex-shrink: 0;
      }

      .page-title {
        flex: 1;
      }

      .page-title h1 {
        margin: 0 0 2px;
        font-size: var(--wa-font-size-l);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .page-title p {
        margin: 0;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }

      .editor-card {
        flex: 1;
        background: var(--wa-color-surface-default);
        border-radius: var(--wa-border-radius-l);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        box-shadow: var(--wa-elevation-02);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .back {
        cursor: pointer;
      }

      .back wa-icon {
        font-size: var(--wa-font-size-l);
        color: var(--esphome-primary);
      }
    `,
  ];

  protected render() {
    return html`
      <div class="page">
        <div class="page-header">
          <div class="back" @click=${this._goBack} title="Back">
            <wa-icon library="mdi" name="arrow-left"></wa-icon>
          </div>
          <div class="page-title">
            <h1>${this._localize("secrets.title")}</h1>
            <p>${this._localize("secrets.desc")}</p>
          </div>
          <wa-button
            size="small"
            variant="brand"
            ?disabled=${this._saving || !this._loaded}
            @click=${this._save}
          >
            ${this._saving
              ? html`<wa-spinner slot="prefix"></wa-spinner>`
              : html`<wa-icon slot="prefix" library="mdi" name="content-save"></wa-icon>`}
            ${this._saving
              ? this._localize("secrets.saving")
              : this._localize("secrets.save")}
          </wa-button>
        </div>
        <wa-divider></wa-divider>
        <div class="editor-card">
          <esphome-yaml-editor
            .value=${this._yaml}
            @yaml-change=${(e: CustomEvent) => {
              this._yaml = e.detail.value;
            }}
          ></esphome-yaml-editor>
        </div>
      </div>
    `;
  }

  private _goBack() {
    window.history.back();
  }

  private async _save() {
    this._saving = true;
    try {
      await this._api.updateConfig(SECRETS_FILE, this._yaml);
      toast.success(this._localize("secrets.saved"), { richColors: true });
    } catch {
      toast.error(this._localize("secrets.save_error"), { richColors: true });
    } finally {
      this._saving = false;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-page-secrets": ESPHomePageSecrets;
  }
}
