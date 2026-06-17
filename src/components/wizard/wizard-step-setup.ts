import { consume } from "@lit/context";
import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { boardImageUrl } from "../../util/board-image.js";
import { EnterController } from "../../util/enter-controller.js";

@customElement("esphome-wizard-step-setup")
export class ESPHomeWizardStepSetup extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api!: ESPHomeAPI;

  @property({ attribute: false })
  public board: BoardCatalogEntry | null = null;

  // Set by the parent dialog; the step stays mounted while the dialog is
  // hidden, so the Enter listener follows this rather than connectedCallback.
  @property({ type: Boolean }) active = false;

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

  // Enter advances / finishes the current stage, mirroring the primary button.
  // Ignore OS key-repeat so a held Enter can't cross a stage boundary and
  // auto-finish past the unreviewed wifi screen (the step stays mounted across
  // stages, so the latch idiom the dialogs use doesn't apply).
  private _enter = new EnterController(this, (e) => {
    if (e.repeat) return;
    if (this._canAdvance()) this._onNext();
  });

  private _canAdvance(): boolean {
    return this._stage === "name" ? !!this._deviceName.trim() : !!this._wifiSsid.trim();
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("active")) this._enter.set(this.active);
  }

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
    inputStyles,
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
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 0 14px;
        height: 36px;
        box-sizing: border-box;
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        border-radius: var(--wa-border-radius-m);
        cursor: pointer;
        border: var(--wa-border-width-s) solid transparent;
        transition:
          background 0.12s,
          border-color 0.12s;
      }

      .btn-secondary {
        background: var(--wa-color-surface-raised);
        border-color: var(--wa-color-surface-border);
        color: var(--wa-color-text-normal);
      }

      .btn-secondary:hover {
        background: var(--wa-color-surface-lowered);
        border-color: var(--wa-color-text-quiet);
      }

      .btn-primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn-primary:hover {
        background: var(--esphome-primary-hover);
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
              src=${boardImageUrl(board)}
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
            ?disabled=${!this._canAdvance()}
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
            autocomplete="off"
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
            autocomplete="off"
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
            autocomplete="off"
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
        // Empty ssid/psk tells the backend to emit unquoted !secret tags.
        this._finish("", "");
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

    // If the user kept the value from secrets, send empty so the backend
    // emits the !secret reference instead of a hardcoded value.
    const ssid =
      this._wifiSsid === this._secretWifiSsid && this._secretWifiSsid
        ? ""
        : this._wifiSsid;
    const password =
      this._wifiPassword === this._secretWifiPassword && this._secretWifiPassword
        ? ""
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
