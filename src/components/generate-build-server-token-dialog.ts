/**
 * "Generate token" flow for the Build server section.
 *
 * Two-step modal:
 *
 * 1. **Label form** — operator types a label for the new
 *    token (e.g. ``green``, ``laptop``). Generate button mints
 *    the bearer client-side via :func:`mintRemoteBuildBearer`,
 *    POSTs only the SHA-256 hash via ``addRemoteBuildToken``,
 *    and on success swaps the dialog body to the reveal step.
 *
 * 2. **Reveal step** — shows the cleartext bearer ONCE with a
 *    Copy button. Bearer stays in component state until the
 *    user clicks Done; then it's nulled out and the user can
 *    never recover it through the UI. The receiver doesn't
 *    have it either (it's already discarded server-side once
 *    we confirmed the hash store), so the operator MUST copy
 *    it into the sender during this window.
 *
 * Why one component for both steps: the cleartext bearer
 * lives in one place's local state for one component lifetime,
 * gets discarded on close. Splitting into two components
 * would require passing the bearer between them, multiplying
 * the cleartext footprint and obscuring the "generate →
 * reveal → discard" lifecycle.
 *
 * Emits ``token-issued`` (bubbling, composed) when the new
 * token has been confirmed by the backend, so the parent
 * Settings dialog can refresh its list. The event payload is
 * the issued :class:`TokenSummary` (no cleartext); the
 * cleartext stays inside this component.
 */

import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import { APIError } from "../api/api-error.js";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import { ErrorCode, type TokenSummary } from "../api/types.js";
import type { LocalizeFunc } from "../common/localize.js";
import { apiContext, localizeContext } from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { copyToClipboard } from "../util/copy-to-clipboard.js";
import { mintRemoteBuildBearer } from "../util/remote-build-bearer.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

@customElement("esphome-generate-build-server-token-dialog")
export class ESPHomeGenerateBuildServerTokenDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @consume({ context: apiContext })
  private _api?: ESPHomeAPI;

  /** Form state — the label the operator typed. */
  @state()
  private _label = "";

  /** ``true`` while we're awaiting the ``add_token`` response. */
  @state()
  private _submitting = false;

  /**
   * Cleartext bearer to display in the reveal step. ``null`` =
   * we're still on the label form. Cleared on close so the
   * cleartext doesn't outlive the user's copy-then-Done window.
   */
  @state()
  private _bearer: string | null = null;

  /** Server-side error text to surface inline on the form. */
  @state()
  private _formError: string | null = null;

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  /**
   * Open the dialog. Clears prior form state so a re-open
   * doesn't show stale label text or a stale bearer.
   */
  open() {
    this._label = "";
    this._submitting = false;
    this._bearer = null;
    this._formError = null;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    // Safety net for the case where the parent route changes
    // (browser-back, link click outside the dialog) without
    // wa-after-hide firing first. The element is about to be
    // GC'd anyway; this just makes sure the cleartext doesn't
    // sit in JS heap waiting for it.
    this._bearer = null;
  }

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      wa-dialog {
        --width: 480px;
      }

      wa-dialog::part(header) {
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-s);
      }

      wa-dialog::part(title) {
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      wa-dialog::part(close-button__base) {
        background: transparent;
        border: none;
        box-shadow: none;
      }

      wa-dialog::part(body) {
        padding: 0 var(--wa-space-l);
      }

      wa-dialog::part(footer) {
        display: none;
      }

      .desc {
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        margin: 0 0 var(--wa-space-m);
        line-height: 1.4;
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
        padding-bottom: var(--wa-space-m);
      }

      .field label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
      }

      .field-error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-xs);
        margin-top: var(--wa-space-2xs);
      }

      /* Action row + button styles match the rest of the
         form-style dialogs (friendly-name, clone-device,
         adopt). Inlined per-dialog like those — there's no
         shared form-dialog stylesheet yet. */
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m) var(--wa-space-l) var(--wa-space-l);
        margin: 0 calc(-1 * var(--wa-space-l));
      }

      .btn {
        padding: 8px 18px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: none;
        transition: background 0.12s;
      }

      .btn--cancel {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .btn--cancel:hover {
        background: var(--wa-color-surface-border);
      }

      .btn--primary {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn--primary:hover:not(:disabled) {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .btn--primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      /* One-time-token reveal: warning banner shape mirrors
         settings-dialog's .phase-banner; same colour stack
         from the WA warning palette. Two copies for now,
         extract to styles/ if a third lands. */
      .reveal-warn {
        margin: 0 0 var(--wa-space-m);
        padding: var(--wa-space-s) var(--wa-space-m);
        border-radius: var(--wa-border-radius-s);
        background: var(--wa-color-warning-fill-quiet, #fff7e0);
        color: var(--wa-color-warning-text-quiet, #6b4f00);
        border-left: 3px solid var(--wa-color-warning-border-loud, #f0b400);
        font-size: var(--wa-font-size-s);
      }

      .reveal-token-wrap {
        padding: 10px 14px;
        background: var(--wa-color-surface-lowered);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
        border-radius: var(--wa-border-radius-m);
        margin-bottom: var(--wa-space-m);
      }

      .reveal-token-value {
        font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
        font-size: var(--wa-font-size-xs);
        word-break: break-all;
        user-select: all;
      }
    `,
  ];

  protected render() {
    return html`
      <wa-dialog
        label=${this._localize(
          this._bearer === null
            ? "settings.build_server_generate_token_title"
            : "settings.build_server_token_reveal_title"
        )}
        @wa-after-hide=${this._onAfterHide}
        @wa-request-close=${this._onRequestClose}
      >
        ${this._bearer === null ? this._renderForm() : this._renderReveal()}
      </wa-dialog>
    `;
  }

  /**
   * Block close while the ``addRemoteBuildToken`` round-trip is in
   * flight. If the dialog closed mid-request, the backend would
   * still create the token (we already POSTed the hash) but the
   * user would never see the cleartext, stranding them with a
   * token they can't paste anywhere. Same pattern as
   * ``<esphome-adopt-dialog>``'s busy guard.
   */
  private _onRequestClose = (e: Event) => {
    if (this._submitting) {
      e.preventDefault();
    }
  };

  private _renderForm() {
    return html`
      <p class="desc">${this._localize("settings.build_server_generate_token_desc")}</p>
      <form @submit=${this._onSubmit}>
        <div class="field">
          <label for="token-label">
            ${this._localize("settings.build_server_token_label_field")}
          </label>
          <input
            id="token-label"
            type="text"
            required
            maxlength="128"
            autocomplete="off"
            spellcheck="false"
            placeholder=${this._localize("settings.build_server_token_label_placeholder")}
            .value=${this._label}
            @input=${(e: InputEvent) => {
              this._label = (e.target as HTMLInputElement).value;
              this._formError = null;
            }}
          />
        </div>
        ${this._formError !== null
          ? html`<p class="field-error" role="alert">${this._formError}</p>`
          : nothing}
        <div class="actions">
          <button
            type="button"
            class="btn btn--cancel"
            ?disabled=${this._submitting}
            @click=${this.close}
          >
            ${this._localize("layout.cancel")}
          </button>
          <button
            type="submit"
            class="btn btn--primary"
            ?disabled=${this._submitting || this._label.trim().length === 0}
          >
            ${this._submitting
              ? this._localize("settings.build_server_generate_token_submitting")
              : this._localize("settings.build_server_generate_token_submit")}
          </button>
        </div>
      </form>
    `;
  }

  private _renderReveal() {
    return html`
      <p class="reveal-warn" role="alert">
        ${this._localize("settings.build_server_token_reveal_warn")}
      </p>
      <div class="reveal-token-wrap">
        <div class="reveal-token-value">${this._bearer}</div>
      </div>
      <div class="actions">
        <button type="button" class="btn btn--cancel" @click=${this._onCopy}>
          ${this._localize("settings.build_server_token_reveal_copy")}
        </button>
        <button type="button" class="btn btn--primary" @click=${this.close}>
          ${this._localize("settings.build_server_token_reveal_done")}
        </button>
      </div>
    `;
  }

  private async _onSubmit(e: Event) {
    e.preventDefault();
    if (this._api === undefined || this._submitting) return;
    const label = this._label.trim();
    if (label.length === 0) return;
    this._submitting = true;
    this._formError = null;
    // Mint client-side so the cleartext never crosses the wire
    // to the backend (3b3 contract). The backend stores only
    // the SHA-256 hash; we keep the cleartext in this
    // component's local state until the user clicks Done.
    // ``mintRemoteBuildBearer`` throws when
    // ``crypto.getRandomValues`` is unavailable (modern browsers
    // expose it everywhere, including http://, but a hardened /
    // sandboxed runtime could legitimately lack it). Catch and
    // surface a typed message so the dialog doesn't get stuck
    // in ``_submitting=true`` with no feedback.
    let minted: ReturnType<typeof mintRemoteBuildBearer>;
    try {
      minted = mintRemoteBuildBearer();
    } catch {
      this._submitting = false;
      this._formError = this._localize("settings.build_server_generate_token_failed");
      return;
    }
    let issued: TokenSummary;
    try {
      issued = await this._api.addRemoteBuildToken({
        label,
        token_id: minted.token_id,
        secret_sha256: minted.secret_sha256,
      });
    } catch (err) {
      this._submitting = false;
      // Surface the specific error_code so the form can render
      // a typed message instead of a generic "couldn't save".
      if (err instanceof APIError && err.errorCode === ErrorCode.ALREADY_EXISTS) {
        // ``token_id`` collision is astronomically unlikely
        // (64 bits of entropy) but the receiver enforces
        // uniqueness; if it somehow happens, the user can
        // retry and we'll mint a fresh id.
        this._formError = this._localize(
          "settings.build_server_generate_token_duplicate"
        );
      } else if (err instanceof APIError && err.errorCode === ErrorCode.INVALID_ARGS) {
        this._formError = this._localize("settings.build_server_generate_token_invalid");
      } else {
        this._formError = this._localize("settings.build_server_generate_token_failed");
      }
      return;
    }
    // Success: compose the wire bearer + transition to reveal.
    this._bearer = `${minted.token_id}.${minted.secret}`;
    this._submitting = false;
    // Notify the parent so the tokens list refreshes. The
    // event payload is the TokenSummary (no cleartext); the
    // cleartext stays inside this component.
    this.dispatchEvent(
      new CustomEvent("token-issued", {
        bubbles: true,
        composed: true,
        detail: issued,
      })
    );
  }

  private async _onCopy() {
    if (this._bearer === null) return;
    if (await copyToClipboard(this._bearer)) {
      // Don't toast here — the bearer is still on screen, the
      // user has visible confirmation that the copy happened
      // (their own paste). Spawning a toast would add visual
      // noise to a security-sensitive moment where the user
      // wants to focus on getting the bearer into the sender.
    }
  }

  private _onAfterHide() {
    // Discard the cleartext as soon as the dialog closes —
    // either by the Done button, the X button, the ESC key,
    // or the wa-dialog backdrop click. The bearer should
    // never outlive the user's "I'm copying it now" window.
    this._bearer = null;
    this._label = "";
    this._formError = null;
    this._submitting = false;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-generate-build-server-token-dialog": ESPHomeGenerateBuildServerTokenDialog;
  }
}
