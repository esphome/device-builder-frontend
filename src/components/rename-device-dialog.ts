import { consume } from "@lit/context";
import { css, html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
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
import { fireEvent } from "../util/fire-event.js";
import { deviceNameValidity, renderDeviceNameField } from "./shared/device-name-field.js";

import "@home-assistant/webawesome/dist/components/checkbox/checkbox.js";
import "./base-dialog.js";

/** Payload of ``rename-confirm``; an absent field was left unchanged. */
export interface RenameConfirmDetail {
  newName?: string;
  newFriendlyName?: string;
  install: boolean;
}

/**
 * Rename dialog: friendly name and hostname in one form, plus an
 * "Install immediately" toggle. Both names live in the device YAML;
 * the page handler picks the backend path from which fields changed.
 */
@customElement("esphome-rename-device-dialog")
export class ESPHomeRenameDeviceDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @state()
  private _name = "";

  @state()
  private _friendly = "";

  @state()
  private _install = true;

  // Snapshot taken by ``open()``; the dialog reports changes against it.
  private _initialName = "";
  private _initialFriendly = "";

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
        --width: 460px;
      }

      esphome-base-dialog::part(body) {
        padding: 0 var(--wa-space-l);
      }

      .install-row {
        display: flex;
        align-items: center;
        gap: var(--wa-space-s);
        padding-bottom: var(--wa-space-m);
      }
    `,
  ];

  // One-shot latch: base-dialog detaches its Enter listener the instant
  // ``open`` flips false, but the buttons stay clickable through the hide
  // animation — a second activation must not dispatch rename-confirm twice.
  private _resolved = false;

  open(name: string, friendlyName: string) {
    this._initialName = name;
    this._initialFriendly = friendlyName;
    this._name = name;
    this._friendly = friendlyName;
    this._install = true;
    this._resolved = false;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    const name = this._name.trim();
    const validity = deviceNameValidity(name, !!name && name !== this._initialName);
    const friendlyErr = this._friendly.trim()
      ? null
      : { code: "dashboard.action_friendly_name_required" };

    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${this._localize("dashboard.action_rename_title", {
          name: this._initialFriendly,
        })}
        .confirmOnEnter=${this._confirm}
        @request-close=${this._dialog.onRequestClose}
      >
        ${renderDeviceNameField({
          localize: this._localize,
          labelKey: "dashboard.action_friendly_name_label",
          helperKey: "dashboard.action_friendly_name_helper",
          value: this._friendly,
          validity: { err: friendlyErr, warning: null },
          onInput: (value) => {
            this._friendly = value;
          },
          id: "friendly-name-input",
          placeholder: this._initialFriendly,
        })}
        ${renderDeviceNameField({
          localize: this._localize,
          labelKey: "dashboard.action_rename_label",
          value: this._name,
          validity,
          onInput: (value) => {
            this._name = value;
          },
          id: "rename-device-name",
          autofocus: false,
        })}
        <div class="install-row">
          <wa-checkbox
            .checked=${this._install}
            @change=${(e: Event) => {
              this._install = (e.target as HTMLInputElement).checked;
            }}
            >${this._localize("dashboard.action_rename_install_after")}</wa-checkbox
          >
        </div>
        ${
          !this._install
            ? html`<div class="field">
                <span class="helper"
                  >${this._localize("dashboard.action_rename_install_skipped")}</span
                >
              </div>`
            : nothing
        }
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${this._detail() === null}
            @click=${this._confirm}
          >
            ${this._localize("dashboard.action_rename_confirm")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  /** The confirm payload, or ``null`` while nothing changed or a field is invalid. */
  private _detail(): RenameConfirmDetail | null {
    const name = this._name.trim();
    const friendly = this._friendly.trim();
    if (!name || !friendly) return null;
    const newName = name === this._initialName ? undefined : name;
    const newFriendlyName = friendly === this._initialFriendly ? undefined : friendly;
    if (newName === undefined && newFriendlyName === undefined) return null;
    if (newName !== undefined && validateDeviceName(newName)) return null;
    return { newName, newFriendlyName, install: this._install };
  }

  // Arrow property: passed as base-dialog's ``confirmOnEnter`` (Enter
  // confirms). Self-guards on unchanged / invalid, as that contract requires.
  private _confirm = () => {
    if (this._resolved) return;
    const detail = this._detail();
    if (detail === null) return;
    this._resolved = true;
    this.close();
    fireEvent(this, "rename-confirm", detail);
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-rename-device-dialog": ESPHomeRenameDeviceDialog;
  }
}
