import { consume } from "@lit/context";
import { LitElement, css, html, nothing } from "lit";
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
import { getDeviceNameWarning, validateDeviceName } from "../util/config-validation.js";
import { DialogOpenController } from "../util/dialog-open-controller.js";
import { renderInlineError } from "../util/render-error.js";

import "./base-dialog.js";

/**
 * Clone-device dialog. Two inputs:
 *
 * - **Hostname** (``new_name``) — the cloned config's
 *   ``esphome.name``. Validated through the same
 *   ``validateDeviceName`` / ``getDeviceNameWarning`` pipeline as
 *   rename, so warnings about underscores / hyphens / etc. surface
 *   here too.
 * - **Friendly name** — the cloned config's ``esphome.friendly_name``.
 *   Optional; the backend defaults to ``friendly_name_slugify(new_name)``
 *   when omitted, so leaving the field blank still produces a
 *   distinct label.
 *
 * Emits ``clone-confirm`` on submit with
 * ``{newName, newFriendlyName}`` (the friendly name is ``""`` when
 * the user left the field blank — the page handler decides whether
 * to forward as ``undefined`` so the backend defaults kick in).
 */
@customElement("esphome-clone-device-dialog")
export class ESPHomeCloneDeviceDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property()
  sourceName = "";

  @state()
  private _name = "";

  @state()
  private _friendlyName = "";

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
    `,
  ];

  // One-shot latch: base-dialog detaches its Enter listener the instant
  // ``open`` flips false, but the buttons stay clickable through the hide
  // animation — a second activation must not dispatch clone-confirm twice.
  private _resolved = false;

  open(sourceName: string) {
    this.sourceName = sourceName;
    this._name = "";
    this._friendlyName = "";
    this._resolved = false;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    const trimmedName = this._name.trim();
    const sameAsSource = trimmedName === this.sourceName;
    const showsValidation = trimmedName.length > 0;
    // Same gate the rename dialog uses, plus a sameness check —
    // the backend rejects ``new_name == source`` anyway, but
    // catching it client-side keeps the submit button disabled
    // instead of letting the user fire and see an error toast.
    const err =
      sameAsSource && showsValidation
        ? { code: "dashboard.action_clone_same_name", params: undefined }
        : showsValidation
          ? validateDeviceName(trimmedName)
          : null;
    const warning = showsValidation && !err ? getDeviceNameWarning(trimmedName) : null;
    const canSubmit = trimmedName.length > 0 && !err;

    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${this._localize("dashboard.action_clone_title", {
          name: this.sourceName,
        })}
        .confirmOnEnter=${this._confirm}
        @request-close=${this._dialog.onRequestClose}
      >
        <div class="field">
          <label for="clone-new-name"
            >${this._localize("dashboard.action_clone_name_label")}</label
          >
          <input
            id="clone-new-name"
            type="text"
            autofocus
            class=${err ? "invalid" : ""}
            .value=${this._name}
            placeholder=${this.sourceName}
            @input=${(e: Event) => {
              this._name = (e.target as HTMLInputElement).value;
            }}
          />
          ${
            err
              ? renderInlineError(this._localize(err.code, err.params))
              : warning
                ? html`<span class="field-warning"
                    >${this._localize(warning.code, warning.params)}</span
                  >`
                : nothing
          }
        </div>
        <div class="field">
          <label for="clone-friendly-name"
            >${this._localize("dashboard.action_clone_friendly_name_label")}</label
          >
          <input
            id="clone-friendly-name"
            type="text"
            .value=${this._friendlyName}
            placeholder=${this._localize(
              "dashboard.action_clone_friendly_name_placeholder"
            )}
            @input=${(e: Event) => {
              this._friendlyName = (e.target as HTMLInputElement).value;
            }}
          />
          <span class="helper"
            >${this._localize("dashboard.action_clone_friendly_name_helper")}</span
          >
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
            ${this._localize("dashboard.action_clone_confirm")}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  // Passed as base-dialog's ``confirmOnEnter`` (Enter confirms).
  // Self-guards on empty / same / invalid, as that contract requires.
  private _confirm = () => {
    if (this._resolved) return;
    const newName = this._name.trim();
    if (!newName || newName === this.sourceName) return;
    if (validateDeviceName(newName)) return;
    this._resolved = true;
    this.close();
    this.dispatchEvent(
      new CustomEvent<{ newName: string; newFriendlyName: string }>("clone-confirm", {
        detail: { newName, newFriendlyName: this._friendlyName.trim() },
        bubbles: true,
        composed: true,
      })
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-clone-device-dialog": ESPHomeCloneDeviceDialog;
  }
}
