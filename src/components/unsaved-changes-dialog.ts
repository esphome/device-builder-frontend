import { consume } from "@lit/context";
import { mdiAlertOutline, mdiContentSave } from "@mdi/js";
import { LitElement, css, html } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { espHomeStyles } from "../styles/shared.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/dialog/dialog.js";
import "@home-assistant/webawesome/dist/components/icon/icon.js";

registerMdiIcons({
  "alert-outline": mdiAlertOutline,
  "content-save": mdiContentSave,
});

@customElement("esphome-unsaved-changes-dialog")
export class ESPHomeUnsavedChangesDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  @query("wa-dialog")
  private _dialog!: HTMLElement & { open: boolean };

  private _resolved = false;

  open() {
    this._resolved = false;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  static styles = [
    espHomeStyles,
    css`
      wa-dialog {
        --width: 460px;
      }

      wa-dialog::part(header),
      wa-dialog::part(footer) {
        display: none;
      }

      wa-dialog::part(body) {
        padding: 0;
      }

      .body {
        display: flex;
        gap: var(--wa-space-m);
        padding: var(--wa-space-l) var(--wa-space-l) var(--wa-space-m);
      }

      .icon-wrap {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        flex-shrink: 0;
        background: color-mix(in srgb, var(--esphome-warning), transparent 85%);
        color: var(--esphome-warning);
      }

      .icon-wrap wa-icon {
        font-size: 24px;
      }

      .text {
        flex: 1;
        min-width: 0;
      }

      .heading {
        margin: 0 0 var(--wa-space-2xs);
        font-size: var(--wa-font-size-m);
        font-weight: var(--wa-font-weight-bold);
        color: var(--wa-color-text-normal);
      }

      .message {
        margin: 0;
        font-size: var(--wa-font-size-s);
        color: var(--wa-color-text-quiet);
        line-height: 1.5;
      }

      .actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--wa-space-xs);
        padding: var(--wa-space-s) var(--wa-space-m) var(--wa-space-m);
      }

      .btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        border-radius: var(--wa-border-radius-m);
        font-size: var(--wa-font-size-s);
        font-weight: var(--wa-font-weight-bold);
        font-family: inherit;
        cursor: pointer;
        border: none;
        transition:
          background 0.12s,
          color 0.12s;
      }

      .btn--ghost {
        background: transparent;
        color: var(--wa-color-text-quiet);
      }

      .btn--ghost:hover {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
      }

      .btn--discard {
        background: transparent;
        color: var(--esphome-error);
      }

      .btn--discard:hover {
        background: color-mix(in srgb, var(--esphome-error), transparent 92%);
      }

      .btn--save {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
        box-shadow: 0 1px 2px color-mix(in srgb, var(--esphome-primary), transparent 70%);
      }

      .btn--save:hover {
        background: color-mix(in srgb, var(--esphome-primary), black 10%);
      }

      .btn wa-icon {
        font-size: 16px;
      }
    `,
  ];

  protected render() {
    return html`
      <wa-dialog light-dismiss @wa-after-hide=${this._onAfterHide}>
        <div class="body">
          <div class="icon-wrap">
            <wa-icon library="mdi" name="alert-outline"></wa-icon>
          </div>
          <div class="text">
            <h2 class="heading">${this._localize("device.unsaved_title")}</h2>
            <p class="message">${this._localize("device.unsaved_message")}</p>
          </div>
        </div>
        <div class="actions">
          <button class="btn btn--ghost" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
          <button class="btn btn--discard" @click=${this._onDiscard}>
            ${this._localize("device.discard_changes")}
          </button>
          <button class="btn btn--save" @click=${this._onSave}>
            <wa-icon library="mdi" name="content-save"></wa-icon>
            ${this._localize("device.save_and_leave")}
          </button>
        </div>
      </wa-dialog>
    `;
  }

  private _onDiscard() {
    this._resolved = true;
    this.close();
    this.dispatchEvent(new CustomEvent("discard", { bubbles: true, composed: true }));
  }

  private _onSave() {
    this._resolved = true;
    this.close();
    this.dispatchEvent(new CustomEvent("save", { bubbles: true, composed: true }));
  }

  private _onAfterHide() {
    if (!this._resolved) {
      this.dispatchEvent(new CustomEvent("cancel", { bubbles: true, composed: true }));
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-unsaved-changes-dialog": ESPHomeUnsavedChangesDialog;
  }
}
