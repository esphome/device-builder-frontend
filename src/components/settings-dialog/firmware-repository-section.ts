import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { ESPHomeAPI } from "../../api/index.js";
import type { FirmwareRepositoryAccessToken } from "../../api/types/firmware-repository.js";
import type { LocalizeFunc } from "../../common/localize.js";
import {
  apiContext,
  firmwareRepositoryAccessEnabledContext,
  firmwareRepositoryAuthenticatePublicContext,
  localizeContext,
} from "../../context/index.js";
import { espHomeStyles } from "../../styles/shared.js";
import { copyToClipboard } from "../../util/copy-to-clipboard.js";
import { fireEvent } from "../../util/fire-event.js";
import { notifyError, notifySuccess } from "../../util/notify.js";
import { renderToggleRow } from "./settings-rows.js";
import { settingsRowStyles, settingsSharedStyles } from "./shared-styles.js";

@customElement("esphome-settings-firmware-repository")
export class ESPHomeSettingsFirmwareRepository extends LitElement {
  @consume({ context: apiContext, subscribe: true })
  @state()
  private _api!: ESPHomeAPI;

  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: firmwareRepositoryAccessEnabledContext, subscribe: true })
  @state()
  private _accessEnabled = false;

  @consume({ context: firmwareRepositoryAuthenticatePublicContext, subscribe: true })
  @state()
  private _authenticatePublic = true;

  @state()
  private _tokens: FirmwareRepositoryAccessToken[] = [];

  @state()
  private _tokenName = "";

  @state()
  private _createdToken: string | null = null;

  @state()
  private _createdTokenName = "";

  @state()
  private _createdTokenId = "";

  @state()
  private _tokensLoading = true;

  @state()
  private _tokenBusy = false;

  @state()
  private _tokenError = "";

  static styles = [
    espHomeStyles,
    settingsSharedStyles,
    settingsRowStyles,
    css`
      .token-management {
        display: grid;
        gap: var(--wa-space-m);
        padding-top: var(--wa-space-m);
      }

      .token-management h3 {
        margin: 0;
        font-size: var(--wa-font-size-m);
      }

      .token-management p {
        margin: 0;
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-s);
      }

      .token-form {
        display: flex;
        align-items: flex-end;
        flex-wrap: wrap;
        gap: var(--wa-space-s);
      }

      .token-name-field {
        display: grid;
        flex: 1 1 220px;
        gap: var(--wa-space-xs);
        color: var(--wa-color-text-normal);
        font-size: var(--wa-font-size-s);
      }

      .token-name-field input {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        padding: var(--wa-space-s);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-s);
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-normal);
        font: inherit;
      }

      .token-button {
        min-height: 36px;
        padding: 0 var(--wa-space-s);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-s);
        background: var(--wa-color-surface-default);
        color: var(--wa-color-text-normal);
        font: inherit;
        cursor: pointer;
      }

      .token-button:hover {
        background: var(--esphome-tint);
      }

      .token-button:disabled {
        opacity: 0.55;
        cursor: default;
      }

      .token-button--danger {
        color: var(--esphome-error);
      }

      .token-list {
        display: grid;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .token-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wa-space-m);
        padding: var(--wa-space-s) 0;
        border-bottom: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .token-meta {
        display: grid;
        min-width: 0;
        gap: 2px;
      }

      .token-meta time,
      .token-suffix {
        color: var(--wa-color-text-quiet);
        font-size: var(--wa-font-size-2xs);
      }

      .token-secret {
        display: grid;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m);
        border: var(--wa-border-width-s) solid
          var(--wa-color-warning-border-normal, var(--wa-color-surface-border));
        border-radius: var(--wa-border-radius-s);
        background: var(--wa-color-warning-quiet, var(--wa-color-surface-lowered));
      }

      .token-secret code {
        overflow-wrap: anywhere;
        color: var(--wa-color-text-normal);
        font-family: var(--wa-font-family-code);
        font-size: var(--wa-font-size-s);
      }

      .token-secret p {
        margin: 0;
      }

      .token-secret-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wa-space-s);
      }

      .token-error {
        color: var(--esphome-error) !important;
      }

      @media (max-width: 560px) {
        .token-item {
          align-items: flex-start;
        }
      }
    `,
  ];

  protected firstUpdated(): void {
    void this._loadTokens();
  }

  protected render() {
    return html`
      ${renderToggleRow(this._localize, {
        titleId: "firmware-repository-access-title",
        titleKey: "settings.firmware_repository_access",
        descKey: "settings.firmware_repository_access_desc",
        checked: this._accessEnabled,
        onToggle: this._onAccessToggle,
      })}
      ${renderToggleRow(this._localize, {
        titleId: "firmware-repository-authenticate-title",
        titleKey: "settings.firmware_repository_authenticate_public",
        descKey: "settings.firmware_repository_authenticate_public_desc",
        checked: this._authenticatePublic,
        onToggle: this._onAuthenticateToggle,
      })}
      <section
        class="token-management"
        aria-labelledby="firmware-repository-tokens-title"
      >
        <h3 id="firmware-repository-tokens-title">
          ${this._localize("settings.firmware_repository_tokens")}
        </h3>
        <p>${this._localize("settings.firmware_repository_tokens_desc")}</p>
        <form class="token-form" @submit=${this._onCreateToken}>
          <label class="token-name-field" for="firmware-repository-token-name">
            ${this._localize("settings.firmware_repository_token_name")}
            <input
              id="firmware-repository-token-name"
              name="name"
              maxlength="80"
              required
              .value=${this._tokenName}
              ?disabled=${
                this._tokenBusy ||
                this._tokensLoading ||
                this._tokenError === "settings.firmware_repository_tokens_load_failed"
              }
              @input=${this._onTokenNameInput}
            />
          </label>
          <button
            class="token-button"
            type="submit"
            ?disabled=${
              this._tokenBusy ||
              this._tokensLoading ||
              this._tokenError === "settings.firmware_repository_tokens_load_failed"
            }
          >
            ${this._localize("settings.firmware_repository_token_create")}
          </button>
        </form>
        ${this._renderTokenStatus()} ${this._renderTokenList()}
        ${this._createdToken ? this._renderCreatedToken() : nothing}
      </section>
    `;
  }

  private _renderTokenStatus() {
    if (this._tokensLoading) {
      return html`<p role="status">
        ${this._localize("settings.firmware_repository_tokens_loading")}
      </p>`;
    }
    if (this._tokenError) {
      return html`<p class="token-error" role="alert">
        ${this._localize(this._tokenError)}
        ${
          this._tokenError === "settings.firmware_repository_tokens_load_failed"
            ? html`<button class="token-button" type="button" @click=${this._loadTokens}>
                ${this._localize("settings.firmware_repository_tokens_retry")}
              </button>`
            : nothing
        }
      </p>`;
    }
    return nothing;
  }

  private _renderTokenList() {
    if (this._tokensLoading || this._tokenError) return nothing;
    if (this._tokens.length === 0) {
      return html`<p role="status">
        ${this._localize("settings.firmware_repository_tokens_empty")}
      </p>`;
    }
    return html`<ul
      class="token-list"
      aria-label=${this._localize("settings.firmware_repository_tokens")}
    >
      ${this._tokens.map(
        (token) =>
          html`<li class="token-item">
            <div class="token-meta">
              <strong>${token.name}</strong>
              <span class="token-suffix">
                ${this._localize("settings.firmware_repository_token_suffix", {
                  last_four: token.last_four,
                })}
              </span>
              <time datetime=${token.created_at}
                >${this._formatTokenDate(token.created_at)}</time
              >
            </div>
            <button
              class="token-button token-button--danger"
              type="button"
              aria-label=${this._localize(
                "settings.firmware_repository_token_revoke_label",
                {
                  name: token.name,
                }
              )}
              ?disabled=${this._tokenBusy}
              @click=${() => this._revokeToken(token)}
            >
              ${this._localize("settings.firmware_repository_token_revoke")}
            </button>
          </li>`
      )}
    </ul>`;
  }

  private _renderCreatedToken() {
    return html`<div class="token-secret" role="status">
      <strong
        >${this._localize("settings.firmware_repository_token_created", {
          name: this._createdTokenName,
        })}</strong
      >
      <p>${this._localize("settings.firmware_repository_token_secret_note")}</p>
      <code>${this._createdToken}</code>
      <div class="token-secret-actions">
        <button class="token-button" type="button" @click=${this._copyCreatedToken}>
          ${this._localize("settings.firmware_repository_token_copy")}
        </button>
        <button class="token-button" type="button" @click=${this._dismissCreatedToken}>
          ${this._localize("settings.firmware_repository_token_dismiss")}
        </button>
      </div>
    </div>`;
  }

  private _formatTokenDate(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
  }

  private _onAccessToggle = (): void => {
    fireEvent(this, "set-firmware-repository-access-enabled", !this._accessEnabled);
  };

  private _onAuthenticateToggle = (): void => {
    fireEvent(
      this,
      "set-firmware-repository-authenticate-public",
      !this._authenticatePublic
    );
  };

  private _onTokenNameInput = (event: InputEvent): void => {
    this._tokenName = (event.currentTarget as HTMLInputElement).value;
  };

  private _loadTokens = async (): Promise<void> => {
    this._tokensLoading = true;
    this._tokenError = "";
    try {
      this._tokens = await this._api.firmwareRepositoryAccessTokens();
    } catch (error) {
      console.warn("Failed to load firmware repository tokens:", error);
      this._tokenError = "settings.firmware_repository_tokens_load_failed";
    } finally {
      this._tokensLoading = false;
    }
  };

  private _onCreateToken = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    const name = this._tokenName.trim();
    if (!name || this._tokenBusy) return;

    this._tokenBusy = true;
    this._tokenError = "";
    try {
      const created = await this._api.firmwareRepositoryAddAccessToken(name);
      const { token, ...tokenInfo } = created;
      this._tokens = [...this._tokens, tokenInfo];
      this._createdToken = token;
      this._createdTokenName = created.name;
      this._createdTokenId = created.id;
      this._tokenName = "";
    } catch (error) {
      console.warn("Failed to create firmware repository token:", error);
      this._tokenError = "settings.firmware_repository_token_create_failed";
    } finally {
      this._tokenBusy = false;
    }
  };

  private _revokeToken = async (token: FirmwareRepositoryAccessToken): Promise<void> => {
    if (this._tokenBusy) return;
    this._tokenBusy = true;
    this._tokenError = "";
    try {
      await this._api.firmwareRepositoryDeleteAccessToken(token.id);
      this._tokens = this._tokens.filter((entry) => entry.id !== token.id);
      if (this._createdTokenId === token.id) this._dismissCreatedToken();
    } catch (error) {
      console.warn("Failed to revoke firmware repository token:", error);
      this._tokenError = "settings.firmware_repository_token_revoke_failed";
    } finally {
      this._tokenBusy = false;
    }
  };

  private _copyCreatedToken = async (): Promise<void> => {
    if (!this._createdToken) return;
    const copied = await copyToClipboard(this._createdToken);
    if (copied) {
      notifySuccess(this._localize("settings.firmware_repository_token_copied"));
    } else {
      notifyError(this._localize("settings.firmware_repository_token_copy_failed"));
    }
  };

  private _dismissCreatedToken = (): void => {
    this._createdToken = null;
    this._createdTokenName = "";
    this._createdTokenId = "";
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-settings-firmware-repository": ESPHomeSettingsFirmwareRepository;
  }
}
