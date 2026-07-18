import { consume } from "@lit/context";
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import {
  dialogActionButtonStyles,
  dialogActionsRowStyles,
} from "../styles/dialog-action-buttons.js";
import { dialogChromeStyles, quietCloseButtonStyles } from "../styles/dialog-chrome.js";
import { dialogFieldStyles } from "../styles/dialog-fields.js";
import { inputStyles } from "../styles/inputs.js";
import { espHomeStyles } from "../styles/shared.js";
import { validateDeviceName } from "../util/config-validation.js";
import { DialogOpenController } from "../util/dialog-open-controller.js";
import { deviceNameValidity, renderDeviceNameField } from "./shared/device-name-field.js";

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

  private readonly _dialog = new DialogOpenController(this);

  static styles = [
    espHomeStyles,
    inputStyles,
    // Neutral header + title + quiet close button (shared) — dialog-chrome.ts.
    dialogChromeStyles,
    quietCloseButtonStyles,
    dialogActionsRowStyles,
    dialogActionButtonStyles,
    dialogFieldStyles,
    css`
      esphome-base-dialog {
        --width: 420px;
      }

      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l);
      }
    `,
  ];

  // One-shot latch: base-dialog detaches its Enter listener the instant
  // ``open`` flips false, but the buttons stay clickable through the hide
  // animation — a second activation must not dispatch rename-confirm twice.
  private _resolved = false;

  open(name: string) {
    this.deviceName = name;
    this._value = name;
    this._resolved = false;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    const trimmed = this._value.trim();
    const unchanged = trimmed === this.deviceName || !trimmed;
    const validity = deviceNameValidity(
      trimmed,
      !!trimmed && trimmed !== this.deviceName
    );
    const canSubmit = !unchanged && !validity.err;

    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${this._localize("dashboard.action_rename_title")}
        .confirmOnEnter=${this._confirm}
        @request-close=${this._dialog.onRequestClose}
      >
        ${renderDeviceNameField({
          localize: this._localize,
          labelKey: "dashboard.action_rename_label",
          value: this._value,
          validity,
          onInput: (value) => {
            this._value = value;
          },
          id: "rename-device-name",
        })}
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

  // Arrow property: passed as base-dialog's ``confirmOnEnter`` (Enter
  // confirms). Self-guards on unchanged / invalid, as that contract requires.
  private _confirm = () => {
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
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-rename-device-dialog": ESPHomeRenameDeviceDialog;
  }
}
