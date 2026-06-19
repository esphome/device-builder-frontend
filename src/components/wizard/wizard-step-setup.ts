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
import { fetchSecretKeys, hasSharedWifiSecret } from "../../util/secrets-cache.js";
import { wifiFieldsStyles } from "../onboarding/wifi-fields-styles.js";
import { isWifiPasswordTooShort, renderWifiFields } from "../onboarding/wifi-fields.js";

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

  // secrets.yaml has both wifi_ssid and wifi_password keys (see
  // hasSharedWifiSecret) — the wizard skips Wi-Fi and reuses !secret.
  @state()
  private _wifiConfigured = false;

  /** Collect Wi-Fi only when the board needs it and no shared secret exists
   *  yet; every other board skips the step. */
  private get _collectWifi(): boolean {
    return Boolean(this.board?.requires_wifi) && !this._wifiConfigured;
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
    if (this._stage === "name") return !!this._deviceName.trim();
    // The Wi-Fi stage only appears when Wi-Fi is required, so an SSID is
    // mandatory; a too-short WPA passphrase is also rejected.
    return !!this._wifiSsid.trim() && !isWifiPasswordTooShort(this._wifiPassword);
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("active")) this._enter.set(this.active);
  }

  async connectedCallback() {
    super.connectedCallback();
    // Already configured ⇒ skip the Wi-Fi stage and reuse !secret. Read via the
    // shared, secrets-saved-refreshed key cache (caches [] on failure).
    this._wifiConfigured = hasSharedWifiSecret(await fetchSecretKeys(this._api));
  }

  static styles = [
    espHomeStyles,
    inputStyles,
    wifiFieldsStyles,
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
        color: var(--esphome-primary);
        font-size: var(--wa-font-size-s);
        padding: 0;
        display: inline-flex;
        align-items: center;
        gap: 4px;
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
            ${this._stage === "name" && this._collectWifi
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
          <p class="section-subtitle">${this._localize("wizard.wifi_required_desc")}</p>
        </div>

        ${renderWifiFields({
          localize: this._localize,
          ssid: this._wifiSsid,
          password: this._wifiPassword,
          disabled: false,
          onSsidInput: (v) => {
            this._wifiSsid = v;
          },
          onPasswordInput: (v) => {
            this._wifiPassword = v;
          },
        })}
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
      if (this._collectWifi) {
        this._stage = "wifi";
        return;
      }
      // Nothing to collect: a networked board uses Ethernet/Thread, a
      // configured install reuses !secret, a no-Wi-Fi board gets a no-network
      // stub. Finish straight from the name stage with no credentials.
      this._finish("", "");
      return;
    }
    // Pass the typed credentials through; the backend writes them to
    // secrets.yaml and emits !secret rather than inlining bare values.
    this._finish(this._wifiSsid, this._wifiPassword);
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
