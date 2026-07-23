import { consume } from "@lit/context";
import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import {
  dialogActionButtonStyles,
  dialogActionsRowStyles,
} from "../styles/dialog-action-buttons.js";
import { dialogChromeStyles, quietCloseButtonStyles } from "../styles/dialog-chrome.js";
import { DialogOpenController } from "../util/dialog-open-controller.js";
import type { ESPHomeDeviceNameInputs } from "./shared/device-name-inputs.js";

import "./base-dialog.js";
import "./shared/device-name-inputs.js";

/**
 * Clone-device dialog. One ``esphome-device-name-inputs`` pair: the new
 * friendly name is the primary input and the hostname (``new_name``)
 * derives from it behind the disclosure, with the source name forbidden
 * as the new hostname.
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

  @query("esphome-device-name-inputs")
  private _nameInputs?: ESPHomeDeviceNameInputs;

  private readonly _dialog = new DialogOpenController(this);

  static styles = [
    // Neutral header + title + quiet close button (shared) — dialog-chrome.ts.
    dialogChromeStyles,
    quietCloseButtonStyles,
    dialogActionsRowStyles,
    dialogActionButtonStyles,
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
    this._resolved = false;
    this._nameInputs?.reset();
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._dialog.open}
        .label=${this._localize("dashboard.action_clone_title", {
          name: this.sourceName,
        })}
        .confirmOnEnter=${this._confirm}
        @request-close=${this._dialog.onRequestClose}
      >
        <esphome-device-name-inputs
          .friendlyLabelKey=${"dashboard.action_clone_friendly_name_label"}
          .friendlyPlaceholderKey=${"dashboard.action_clone_friendly_name_placeholder"}
          .friendlyHelperKey=${"dashboard.action_clone_friendly_name_helper"}
          .hostnamePlaceholder=${this.sourceName}
          .forbiddenHostname=${this.sourceName}
          .forbiddenErrorKey=${"dashboard.action_clone_same_name"}
          @device-name-changed=${() => this.requestUpdate()}
        ></esphome-device-name-inputs>
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
          <button
            class="btn btn--primary"
            ?disabled=${!(this._nameInputs?.canSubmit ?? false)}
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
    const inputs = this._nameInputs;
    if (!inputs?.canSubmit) return;
    this._resolved = true;
    this.close();
    this.dispatchEvent(
      new CustomEvent<{ newName: string; newFriendlyName: string }>("clone-confirm", {
        detail: { newName: inputs.hostname, newFriendlyName: inputs.friendlyName },
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
