import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { getDeviceNameWarning, validateDeviceName } from "../util/config-validation.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";

@customElement("esphome-rename-device-dialog")
export class ESPHomeRenameDeviceDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property()
  deviceName = "";

  @state()
  private _value = "";

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    inputStyles,
    css`
      wa-dialog {
        --width: 420px;
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
        padding: var(--wa-space-m) var(--wa-space-l) var(--wa-space-l);
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

  open(name: string) {
    this.deviceName = name;
    this._value = name;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

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
      <wa-dialog label=${this._localize("dashboard.action_rename_title")} light-dismiss>
        <div class="field">
          <label>${this._localize("dashboard.action_rename_label")}</label>
          <input
            type="text"
            class=${err ? "invalid" : ""}
            .value=${this._value}
            @input=${(e: Event) => { this._value = (e.target as HTMLInputElement).value; }}
            @keydown=${(e: KeyboardEvent) => { if (e.key === "Enter" && canSubmit) this._confirm(); }}
          />
          ${err
            ? html`<span class="field-error">${this._localize(err.code, err.params)}</span>`
            : warning
              ? html`<span class="field-warning">${this._localize(warning.code, warning.params)}</span>`
              : nothing}
        </div>
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
          <button class="btn btn--primary" ?disabled=${!canSubmit} @click=${this._confirm}>
            ${this._localize("dashboard.action_rename_confirm")}
          </button>
        </div>
      </wa-dialog>
    `;
  }

  private _confirm() {
    const newName = this._value.trim();
    if (!newName || newName === this.deviceName) return;
    if (validateDeviceName(newName)) return;
    this.close();
    this.dispatchEvent(
      new CustomEvent("rename-confirm", {
        detail: newName,
        bubbles: true,
        composed: true,
      }),
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-rename-device-dialog": ESPHomeRenameDeviceDialog;
  }
}
