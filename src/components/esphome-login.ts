/**
 * Full-screen login page — rendered by the app shell when the server
 * reports ``requires_auth: true`` and we don't have a usable token.
 *
 * Owns only the form state + a rate-limit countdown timer; auth flow
 * (validate / store token / advance to dashboard) lives on the parent
 * which dispatches to ``esphome-api``.
 */
import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";

@customElement("esphome-login")
export class ESPHomeLogin extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** True while the parent's submit handler is awaiting auth/login. */
  @property({ type: Boolean })
  submitting = false;

  /** True when the WebSocket is currently down (reconnect in flight).
   *  Disables submit so we don't fire dead requests, and swaps the
   *  button copy for a "reconnecting…" hint. Inputs stay enabled so
   *  the user can keep typing while waiting. */
  @property({ type: Boolean })
  disconnected = false;

  /** Already-localized error string. ``null`` hides the error region. */
  @property({ type: String })
  error: string | null = null;

  /** Unix-ms timestamp until which the submit button stays disabled
   *  (rate-limit lockout). ``0`` = no lockout. */
  @property({ type: Number, attribute: "rate-limited-until" })
  rateLimitedUntil = 0;

  @state()
  private _username = "";

  @state()
  private _password = "";

  @state()
  private _now = Date.now();

  @query("input[name='username']")
  private _usernameInput!: HTMLInputElement;

  private _tick: ReturnType<typeof setInterval> | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    // Re-render every second while a rate-limit countdown is active
    // so the disabled-button copy ticks down. The interval is harmless
    // when no countdown is set (1Hz is cheap), but we still gate it
    // to avoid lingering work when not needed.
    this._tick = setInterval(() => {
      this._now = Date.now();
    }, 1000);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._tick !== null) {
      clearInterval(this._tick);
      this._tick = null;
    }
  }

  protected firstUpdated(): void {
    // Drop focus into the username field on mount — the form is the
    // only thing on screen, so autofocusing matches user expectation
    // and shortcuts password-manager flows.
    this._usernameInput?.focus();
  }

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      :host {
        display: flex;
        flex: 1;
        align-items: center;
        justify-content: center;
        padding: var(--wa-space-l);
        min-height: 100%;
      }

      .card {
        width: 100%;
        max-width: 380px;
        background: var(--wa-color-surface-raised);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-l);
        padding: var(--wa-space-xl);
        box-shadow: var(--wa-shadow-m);
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-l);
      }

      h1 {
        margin: 0;
        font-size: var(--wa-font-size-xl);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      p.subtitle {
        margin: 0;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
      }

      form {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-m);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      label {
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .error {
        font-size: var(--wa-font-size-s);
        color: var(--esphome-error);
        background: color-mix(in srgb, var(--esphome-error), transparent 90%);
        border-radius: var(--wa-border-radius-m);
        padding: var(--wa-space-s) var(--wa-space-m);
      }

      button[type="submit"] {
        margin-top: var(--wa-space-s);
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        border: none;
        border-radius: var(--wa-border-radius-m);
        padding: 10px 18px;
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        transition: background 0.12s;
      }

      button[type="submit"]:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      button[type="submit"]:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `,
  ];

  protected render() {
    const secondsLeft = Math.max(
      0,
      Math.ceil((this.rateLimitedUntil - this._now) / 1000)
    );
    const rateLimited = secondsLeft > 0;
    const submitDisabled = this.submitting || rateLimited || this.disconnected;
    // Disconnected wins over the other states because submitting one
    // wouldn't go anywhere — the user sees the form is alive but
    // queued behind the reconnect.
    const submitLabel = this.disconnected
      ? this._localize("auth.connecting")
      : this.submitting
        ? this._localize("auth.submitting")
        : rateLimited
          ? this._localize("auth.rate_limited", { seconds: secondsLeft })
          : this._localize("auth.submit");

    return html`
      <div class="card">
        <div>
          <h1>${this._localize("auth.sign_in")}</h1>
          <p class="subtitle">${this._localize("auth.description")}</p>
        </div>
        <form @submit=${this._onSubmit}>
          <div class="field">
            <label for="login-username"> ${this._localize("auth.username")} </label>
            <input
              id="login-username"
              name="username"
              type="text"
              autocomplete="username"
              .value=${this._username}
              ?disabled=${this.submitting}
              @input=${this._onUsernameInput}
            />
          </div>
          <div class="field">
            <label for="login-password"> ${this._localize("auth.password")} </label>
            <input
              id="login-password"
              name="password"
              type="password"
              autocomplete="current-password"
              .value=${this._password}
              ?disabled=${this.submitting}
              @input=${this._onPasswordInput}
            />
          </div>
          ${this.error
            ? html`<div class="error" role="alert">${this.error}</div>`
            : nothing}
          <button type="submit" ?disabled=${submitDisabled}>${submitLabel}</button>
        </form>
      </div>
    `;
  }

  private _onUsernameInput = (e: InputEvent) => {
    this._username = (e.target as HTMLInputElement).value;
  };

  private _onPasswordInput = (e: InputEvent) => {
    this._password = (e.target as HTMLInputElement).value;
  };

  private _onSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    if (this.submitting) return;
    if (this.disconnected) return;
    if (this.rateLimitedUntil > Date.now()) return;
    this.dispatchEvent(
      new CustomEvent("submit-credentials", {
        detail: { username: this._username, password: this._password },
        bubbles: true,
        composed: true,
      })
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-login": ESPHomeLogin;
  }
}
