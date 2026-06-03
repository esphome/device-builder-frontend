import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { dialogChromeStyles, quietCloseButtonStyles } from "../styles/dialog-chrome.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { getDeviceNameWarning, validateDeviceName } from "../util/config-validation.js";
import { EnterController } from "../util/enter-controller.js";
import { renderInlineError } from "../util/render-error.js";

import "./base-dialog.js";

@customElement("esphome-rename-device-dialog")
export class ESPHomeRenameDeviceDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property()
  deviceName = "";

  @state()
  private _value = "";

  @state()
  private _open = false;

  static styles = [
    espHomeStyles,
    inputStyles,
    // Neutral header + title + quiet close button (shared) — dialog-chrome.ts.
    dialogChromeStyles,
    quietCloseButtonStyles,
    css`
      esphome-base-dialog {
        --width: 420px;
      }

      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l);
      }

      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wa-space-xs);
        padding-bottom: var(--wa-space-m);
      }

      label {
        font-size: var(--wa-font-size-xs);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-quiet);
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-s);
        padding: var(--wa-space-m) 0 var(--wa-space-l);
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
        background: var(--esphome-primary-hover);
      }

      .btn--primary:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .field-error {
        color: var(--esphome-error);
        font-size: var(--wa-font-size-xs);
        margin-top: var(--wa-space-2xs);
      }

      /* Soft warning shown alongside the input — same slot as the
         hard error but warning-coloured so the user can tell the two
         apart, and the submit button stays enabled. */
      .field-warning {
        color: var(--esphome-warning, #d97706);
        font-size: var(--wa-font-size-xs);
        margin-top: var(--wa-space-2xs);
      }
    `,
  ];

  // One-shot latch: close() only starts the hide animation, so the
  // EnterController listener stays live until wa-after-hide; without this a
  // held Enter re-enters _confirm and dispatches rename-confirm twice.
  private _resolved = false;

  // Enter confirms; _confirm self-guards on unchanged / invalid.
  private _enter = new EnterController(this, () => this._confirm());

  open(name: string) {
    this.deviceName = name;
    this._value = name;
    this._resolved = false;
    this._open = true;
    this._enter.set(true);
  }

  close() {
    this._open = false;
  }

  // Flip the reactive flag on the initiating close so a re-render can't
  // re-assert ?open mid-hide; teardown (the EnterController unbind) stays
  // in after-hide. esphome-base-dialog never mutates its own open in
  // response to user actions, so the host owns flipping _open here.
  private _onRequestClose = (): void => {
    this._open = false;
  };

  private _onAfterHide = (): void => {
    this._enter.set(false);
  };

  protected render() {
    const trimmed = this._value.trim();
    const unchanged = trimmed === this.deviceName || !trimmed;
    const showsValidation = trimmed && trimmed !== this.deviceName;
    const err = showsValidation ? validateDeviceName(trimmed) : null;
    /* Warnings only render when there's no hard error to show — the
       error messaging would otherwise compete with the warning for
       the same slot. */
    const warning = showsValidation && !err ? getDeviceNameWarning(trimmed) : null;
    const canSubmit = !unchanged && !err;

    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${this._localize("dashboard.action_rename_title")}
        @request-close=${this._onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        <div class="field">
          <label>${this._localize("dashboard.action_rename_label")}</label>
          <input
            type="text"
            class=${err ? "invalid" : ""}
            .value=${this._value}
            @input=${(e: Event) => {
              this._value = (e.target as HTMLInputElement).value;
            }}
          />
          ${err
            ? renderInlineError(this._localize(err.code, err.params))
            : warning
              ? html`<span class="field-warning"
                  >${this._localize(warning.code, warning.params)}</span
                >`
              : nothing}
        </div>
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${!canSubmit}
            @click=${this._confirm}
          >
            ${this._localize("dashboard.action_rename_confirm")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  private _confirm() {
    if (this._resolved) return;
    const newName = this._value.trim();
    if (!newName || newName === this.deviceName) return;
    if (validateDeviceName(newName)) return;
    this._resolved = true;
    this.close();
    this.dispatchEvent(
      new CustomEvent("rename-confirm", {
        detail: newName,
        bubbles: true,
        composed: true,
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-rename-device-dialog": ESPHomeRenameDeviceDialog;
  }
}
