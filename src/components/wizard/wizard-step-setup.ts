import { consume } from "@lit/context";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { BoardCatalogEntry } from "../../api/types/boards.js";
import type { LocalizeFunc } from "../../common/localize.js";
import { apiContext, localizeContext } from "../../context/index.js";
import { inputStyles } from "../../styles/inputs.js";
import { espHomeStyles } from "../../styles/shared.js";
import { boardImageUrl } from "../../util/board-image.js";
import { EnterController } from "../../util/enter-controller.js";
import { boardOffersFullSetup } from "../../util/full-setup.js";
import { fetchSecretKeys, hasSharedWifiSecret } from "../../util/secrets-cache.js";
import { tourAnchor } from "../guided-tour/tour-anchor.js";
import {
  clearTourSuggestedName,
  getTourSuggestedName,
  isTourActive,
} from "../guided-tour/tour-session.js";
import { wifiFieldsStyles } from "../onboarding/wifi-fields-styles.js";
import { isWifiPasswordTooShort, renderWifiFields } from "../onboarding/wifi-fields.js";

import "@home-assistant/webawesome/dist/components/checkbox/checkbox.js";
import "@home-assistant/webawesome/dist/components/spinner/spinner.js";

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

  // Set by the parent dialog while createDevice is in flight; a big board
  // (128-relay full setup) takes seconds, so the button must show progress.
  @property({ type: Boolean }) submitting = false;

  @state()
  private _stage: "name" | "wifi" = "name";

  // secrets.yaml has both wifi_ssid and wifi_password keys (see
  // hasSharedWifiSecret) — the wizard skips Wi-Fi and reuses !secret.
  @state()
  private _wifiConfigured = false;

  /** Show Wi-Fi when credentials are needed, or during the quickstart so users
   *  learn that saved credentials are reused without revealing their values. */
  private get _collectWifi(): boolean {
    return (
      Boolean(this.board?.requires_wifi) && (!this._wifiConfigured || isTourActive())
    );
  }

  @state()
  private _deviceName = "";

  // Pre-checked: a complete onboard device is almost always wanted whole, not
  // assembled component by component. Only shown for full-config boards.
  @state()
  private _fullSetup = true;

  /**
   * Full setup never applies to a remote-package board — the package
   * reference is the whole config, so both the checkbox and the emitted
   * finish-setup flag must stay off even if the body also carries
   * full_config and bundles.
   */
  private get _offersFullSetup(): boolean {
    return !this.board?.package_import_url && boardOffersFullSetup(this.board);
  }

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
    // Match the pointer path: the buttons are disabled while submitting, so the
    // keyboard must honor the same lock (_onNext is the authoritative backstop).
    if (this.submitting) return;
    if (this._canAdvance()) this._onNext();
  });

  private _canAdvance(): boolean {
    if (this._stage === "name") return !!this._deviceName.trim();
    if (this._wifiConfigured) return true;
    // The Wi-Fi stage only appears when Wi-Fi is required, so an SSID is
    // mandatory; a too-short WPA passphrase is also rejected.
    return !!this._wifiSsid.trim() && !isWifiPasswordTooShort(this._wifiPassword);
  }

  protected willUpdate(changed: PropertyValues): void {
    if (changed.has("active")) this._enter.set(this.active);
  }

  async connectedCallback() {
    super.connectedCallback();

    if (!this._deviceName) {
      const suggested = getTourSuggestedName();
      if (suggested) this._deviceName = suggested;
    }
    clearTourSuggestedName();
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

      .full-setup {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-2xs);
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

      .wifi-saved {
        padding: var(--wa-space-m);
        border-radius: var(--wa-border-radius-m);
        background: var(--wa-color-surface-lowered);
      }

      .wifi-saved .section-title {
        margin-bottom: var(--wa-space-2xs);
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

      /* Both variants set an explicit background, which overrides the UA
         disabled greying, so a disabled button would otherwise look active;
         dim it here (Back and Finish setup are both disabled mid-create). */
      .btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* Pin the spinner to a 1em square (box-sizing + flex:none) so it can't
         reflow the button, and tint it to currentColor; same treatment as the
         editor Save button (device-editor.styles.ts). */
      .btn wa-spinner {
        box-sizing: border-box;
        flex: none;
        width: 1em;
        height: 1em;
        --track-width: 2px;
        --indicator-color: currentColor;
        --track-color: color-mix(in srgb, currentColor 30%, transparent);
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
            ${
              board
                ? html`<div class="board-tags">
                    ${board.tags.map(
                      (tag) =>
                        html`<span class="tag"
                          >${this._localize(`wizard.tag.${tag}`)}</span
                        >`
                    )}
                  </div>`
                : null
            }
          </div>
        </div>
        ${
          board
            ? html`<img
                class="board-image"
                src=${boardImageUrl(board)}
                alt=${board.name}
              />`
            : null
        }
      </div>

      <hr class="divider" />

      ${this._stage === "name" ? this._renderNameSection() : this._renderWifiSection()}

      <div class="actions">
        <button
          class="btn btn-secondary"
          type="button"
          ?disabled=${this.submitting}
          @click=${this._onBack}
        >
          ${this._localize("wizard.back")}
        </button>
        <div class="actions-right">
          ${
            this._stage === "wifi" && this._wifiConfigured
              ? html`<button
                  class="btn btn-primary wifi-confirm"
                  type="button"
                  ${tourAnchor("wifi-tour-continue")}
                  ?disabled=${this.submitting}
                  @click=${this._onUseSavedWifi}
                >
                  ${this._localize("wizard.wifi_use_saved")}
                </button>`
              : nothing
          }
          ${
            this._stage === "wifi" && this._wifiConfigured
              ? nothing
              : html`<button
                  class="btn btn-primary"
                  type="button"
                  ${tourAnchor(
                    this._stage === "name" ? "name-finish" : "wifi-tour-continue"
                  )}
                  ?disabled=${!this._canAdvance() || this.submitting}
                  aria-busy=${this.submitting || nothing}
                  @click=${this._onNext}
                >
                  ${this.submitting ? html`<wa-spinner></wa-spinner>` : nothing}
                  ${
                    this._stage === "name" && this._collectWifi
                      ? this._localize("wizard.next")
                      : this._localize("wizard.finish_setup")
                  }
                </button>`
          }
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

        <div class="field" ${tourAnchor("name-field")}>
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

        ${
          this.board?.package_import_url
            ? html`<div class="full-setup">
                <p class="section-subtitle">
                  ${this._localize("wizard.package_config_desc")}
                </p>
              </div>`
            : this._offersFullSetup
              ? html`<div class="full-setup">
                  <wa-checkbox
                    .checked=${this._fullSetup}
                    @change=${(e: Event) => {
                      this._fullSetup = (
                        e.currentTarget as HTMLElement & { checked: boolean }
                      ).checked;
                    }}
                    >${this._localize("wizard.full_setup")}</wa-checkbox
                  >
                  <p class="section-subtitle">
                    ${this._localize("wizard.full_setup_desc")}
                  </p>
                </div>`
              : null
        }
      </section>
    `;
  }

  private _renderWifiSection() {
    return html`
      <section class="section" ${tourAnchor("wifi-fields")}>
        <div>
          <h3 class="section-title">${this._localize("wizard.wifi_configuration")}</h3>
          <p class="section-subtitle">
            ${this._localize(
              this._wifiConfigured
                ? "wizard.wifi_saved_desc"
                : "wizard.wifi_required_desc"
            )}
          </p>
        </div>

        ${
          this._wifiConfigured
            ? html`<div class="wifi-saved" role="status">
                <h4 class="section-title">
                  ${this._localize("wizard.wifi_saved_title")}
                </h4>
                <p class="section-subtitle">
                  ${this._localize("wizard.wifi_saved_reuse")}
                </p>
              </div>`
            : renderWifiFields({
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
              })
        }
      </section>
    `;
  }

  private _onBack() {
    // The disabled attribute blocks the click; guard the handler too so a
    // create in flight can't be stepped back out from under.
    if (this.submitting) return;
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
    // Single in-flight lock for every advance/finish path (button click, Enter
    // key); the disabled buttons block the pointer, this covers the rest so a
    // create can't be re-dispatched or stepped forward mid-add.
    if (this.submitting) return;
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
    if (this._wifiConfigured) {
      this._finish("", "");
      return;
    }
    // Pass the typed credentials through; the backend writes them to
    // secrets.yaml and emits !secret rather than inlining bare values.
    this._finish(this._wifiSsid, this._wifiPassword);
  }

  private _onUseSavedWifi = () => {
    if (this.submitting) return;
    this._finish("", "");
  };

  private _finish(wifiSsid: string, wifiPassword: string) {
    this.dispatchEvent(
      new CustomEvent("finish-setup", {
        detail: {
          board: this.board,
          name: this._deviceName,
          wifiSsid,
          wifiPassword,
          fullSetup: this._offersFullSetup && this._fullSetup,
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
