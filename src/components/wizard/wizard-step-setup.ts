import { consume } from "@lit/context";
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry } from "../../api/types.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";

@customElement("esphome-wizard-step-setup")
export class ESPHomeWizardStepSetup extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property({ attribute: false })
  public board: BoardCatalogEntry | null = null;

  @state()
  private _stage: "name" | "wifi" = "name";

  @state()
  private _secretWifiSsid = "";

  @state()
  private _secretWifiPassword = "";

  private get _hasSecretWifi(): boolean {
    return Boolean(this._secretWifiSsid && this._secretWifiPassword);
  }

  @state()
  private _deviceName = "";

  @state()
  private _wifiSsid = "";

  @state()
  private _wifiPassword = "";

  async connectedCallback() {
    super.connectedCallback();
    try {
      const yaml = await this._api.getConfig("secrets.yaml");
      const ssid = yaml.match(/^wifi_ssid\s*:\s*["']?(.+?)["']?\s*$/m);
      const pass = yaml.match(/^wifi_password\s*:\s*["']?(.+?)["']?\s*$/m);
      if (ssid) this._secretWifiSsid = ssid[1];
      if (pass) this._secretWifiPassword = pass[1];
    } catch {
      // No secrets file — leave defaults
    }
  }

  static styles = [
    espHomeStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-l);
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-m);
      }

      .header-main {
        display: flex;
        align-items: center;
        gap: var(--wa-space-m);
      }

      .back-btn {
        border: none;
        background: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--esphome-primary);
        font-size: var(--wa-font-size-s);
        padding: 0;
      }

      .board-info-title {
        margin: 0;
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .board-tags {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wa-space-2xs);
        margin-top: var(--wa-space-xs);
      }

      .board-image {
        width: 120px;
        height: 80px;
        object-fit: contain;
        border-radius: var(--wa-border-radius-m);
        background: var(--wa-color-surface-default);
        padding: var(--wa-space-xs);
        box-sizing: border-box;
      }

      .divider {
        border: none;
        border-top: 1px solid var(--wa-color-surface-border);
        margin: 0;
      }

      .section {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
      }

      .section-title {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        margin: 0;
      }

      .section-subtitle {
        margin: 0;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
      }

      label {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      input {
        width: 100%;
        padding: var(--wa-space-s) var(--wa-space-m);
        font-size: var(--wa-font-size-m);
        font-family: inherit;
        color: var(--wa-color-text-normal);
        background: var(--wa-color-surface-default);
        border: var(--wa-border-width-m) solid var(--esphome-primary-light);
        border-radius: var(--wa-border-radius-m);
        box-sizing: border-box;
        outline: none;
        transition: border-color var(--wa-transition-normal) var(--wa-transition-easing);
      }

      input:focus {
        border-color: var(--esphome-primary);
      }

      .actions {
        display: flex;
        justify-content: space-between;
        margin-top: var(--wa-space-xl);
      }

      .actions-right {
        display: flex;
        gap: var(--wa-space-s);
      }

      .btn {
        padding: var(--wa-space-s) var(--wa-space-l);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        border: var(--wa-border-width-m) solid transparent;
        transition:
          background var(--wa-transition-normal) var(--wa-transition-easing),
          border-color var(--wa-transition-normal) var(--wa-transition-easing);
      }

      .btn-secondary {
        background: none;
        border-color: var(--esphome-primary-light);
        color: var(--wa-color-text-normal);
      }

      .btn-secondary:hover {
        border-color: var(--esphome-primary);
        background: color-mix(in srgb, var(--esphome-primary), transparent 95%);
      }

      .btn-primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn-primary:hover {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .btn-primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `,
  ];

  protected render() {
    const board = this.board;
    const isStarterKit = board && board.tags.includes("starter-kit");

    return html`
      <div class="header">
        <div class="header-main">
          <div>
            <h2 class="board-info-title">
              ${board ? board.name : this._localize("wizard.title_setup")}
            </h2>
            ${board
              ? html`<div class="board-tags">
                  ${board.tags.map(
                    (tag) =>
                      html`<span class="tag"
                        >${this._localize(`wizard.tag.${tag}`)}</span
                      >`
                  )}
                </div>`
              : null}
          </div>
        </div>
        ${board
          ? html`<img
              class="board-image"
              src=${board.images.length > 0
                ? board.images[0]
                : "/assets/board/default.svg"}
              alt=${board.name}
            />`
          : null}
      </div>

      <hr class="divider" />

      ${this._stage === "name" ? this._renderNameSection() : this._renderWifiSection()}

      <div class="actions">
        <button class="btn btn-secondary" type="button" @click=${this._onBack}>
          ${this._localize("wizard.back")}
        </button>
        <div class="actions-right">
          <button
            class="btn btn-primary"
            type="button"
            ?disabled=${this._stage === "name"
              ? !this._deviceName.trim()
              : !this._wifiSsid.trim()}
            @click=${this._onNext}
          >
            ${this._stage === "name" && !this._hasSecretWifi
              ? this._localize("wizard.next")
              : this._localize("wizard.finish_setup")}
          </button>
        </div>
      </div>
    `;
  }

  private _renderNameSection() {
    return html`
      <section class="section">
        <div>
          <h3 class="section-title">${this._localize("wizard.section_name_device")}</h3>
          <p class="section-subtitle">
            ${this._localize("wizard.section_name_device_desc")}
          </p>
        </div>

        <div class="field">
          <label for="device-name">${this._localize("wizard.device_name")}</label>
          <input
            id="device-name"
            type="text"
            .value=${this._deviceName}
            placeholder=${this._localize("wizard.device_name_placeholder")}
            @input=${(e: InputEvent) => {
              this._deviceName = (e.target as HTMLInputElement).value;
            }}
          />
        </div>
      </section>
    `;
  }

  private _renderWifiSection() {
    return html`
      <section class="section">
        <div>
          <h3 class="section-title">${this._localize("wizard.wifi_configuration")}</h3>
          <p class="section-subtitle">
            ${this._localize("wizard.wifi_configuration_desc")}
          </p>
        </div>

        <div class="field">
          <label for="wifi-ssid">${this._localize("wizard.wifi_ssid")}</label>
          <input
            id="wifi-ssid"
            type="text"
            .value=${this._wifiSsid}
            @input=${(e: InputEvent) => {
              this._wifiSsid = (e.target as HTMLInputElement).value;
            }}
          />
        </div>

        <div class="field">
          <label for="wifi-password">${this._localize("wizard.wifi_password")}</label>
          <input
            id="wifi-password"
            type="password"
            .value=${this._wifiPassword}
            @input=${(e: InputEvent) => {
              this._wifiPassword = (e.target as HTMLInputElement).value;
            }}
          />
        </div>
      </section>
    `;
  }

  private _onBack() {
    if (this._stage === "wifi") {
      this._stage = "name";
      return;
    }
    this.dispatchEvent(
      new CustomEvent("next-step", {
        detail: "board",
        bubbles: true,
        composed: true,
      })
    );
  }

  private _onNext() {
    if (this._stage === "name") {
      if (this._hasSecretWifi) {
        this._finish("!secret wifi_ssid", "!secret wifi_password");
        return;
      }
      if (this._secretWifiSsid && !this._wifiSsid) {
        this._wifiSsid = this._secretWifiSsid;
      }
      if (this._secretWifiPassword && !this._wifiPassword) {
        this._wifiPassword = this._secretWifiPassword;
      }
      this._stage = "wifi";
      return;
    }

    // If the user kept the value from secrets, emit !secret references
    // so the generated YAML uses secrets instead of hardcoded values.
    const ssid =
      this._wifiSsid === this._secretWifiSsid && this._secretWifiSsid
        ? "!secret wifi_ssid"
        : this._wifiSsid;
    const password =
      this._wifiPassword === this._secretWifiPassword && this._secretWifiPassword
        ? "!secret wifi_password"
        : this._wifiPassword;

    this._finish(ssid, password);
  }

  private _finish(wifiSsid: string, wifiPassword: string) {
    this.dispatchEvent(
      new CustomEvent("finish-setup", {
        detail: {
          board: this.board,
          name: this._deviceName,
          wifiSsid,
          wifiPassword,
        },
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-wizard-step-setup": ESPHomeWizardStepSetup;
  }
}
