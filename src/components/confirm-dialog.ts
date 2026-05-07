import { consume } from "@lit/context";
import { mdiAlertOutline } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { dialogCloseButtonStyles } from "../styles/dialog-close-button.js";
import { modalDialogStyles } from "../styles/modal-dialog.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({ "alert-outline": mdiAlertOutline });

@customElement("esphome-confirm-dialog")
export class ESPHomeConfirmDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @property()
  heading = "";

  @property()
  message = "";

  @property({ attribute: "confirm-label" })
  confirmLabel = "";

  @property({ type: Boolean })
  destructive = false;

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  static styles = [
    espHomeStyles,
    modalDialogStyles,
    dialogCloseButtonStyles,
    css`
      wa-dialog {
        --width: 420px;
      }

      .icon-wrap.destructive {
        background: color-mix(in srgb, var(--esphome-error), transparent 88%);
        color: var(--esphome-error);
      }

      .icon-wrap:not(.destructive) {
        background: color-mix(in srgb, var(--esphome-primary), transparent 88%);
        color: var(--esphome-primary);
      }

      .btn--confirm {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn--confirm:hover {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .btn--confirm.destructive {
        background: var(--esphome-error);
      }

      .btn--confirm.destructive:hover {
        background: color-mix(in srgb, var(--esphome-error), black 10%);
      }
    `,
  ];

  private _confirmed = false;

  open() {
    this._confirmed = false;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    return html`
      <wa-dialog
        label=${this.heading}
        light-dismiss
        @wa-after-hide=${this._onAfterHide}
      >
        <div class="body">
          ${this.destructive
            ? html`<div class="icon-wrap destructive">
                <wa-icon library="mdi" name="alert-outline"></wa-icon>
              </div>`
            : nothing}
          <div class="text">${this.message}</div>
        </div>
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
          <button
            class="btn btn--confirm ${this.destructive ? "destructive" : ""}"
            @click=${this._confirm}
          >
            ${this.confirmLabel || this.heading}
          </button>
        </div>
      </wa-dialog>
    `;
  }

  private _confirm() {
    this._confirmed = true;
    this.close();
    this.dispatchEvent(
      new CustomEvent("confirm", { bubbles: true, composed: true }),
    );
  }

  private _onAfterHide() {
    if (!this._confirmed) {
      this.dispatchEvent(
        new CustomEvent("cancel", { bubbles: true, composed: true }),
      );
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-confirm-dialog": ESPHomeConfirmDialog;
  }
}
