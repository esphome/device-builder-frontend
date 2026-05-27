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

  /**
   * Optional secondary-action button label. When non-empty a
   * third button renders between Cancel and Confirm; clicking it
   * fires a "secondary" event (same bubbling shape as the
   * "confirm" event) and counts as a decision so the
   * cancel-on-dismiss path doesn't fire. Use it for two-outcome
   * decisions that aren't quite confirm-or-cancel, e.g. Accept
   * versus Reject on a pairing request.
   */
  @property({ attribute: "secondary-label" })
  secondaryLabel = "";

  @property({ type: Boolean })
  destructive = false;

  /**
   * Optional override for the icon rendered in the destructive
   * icon-wrap. Defaults to "alert-outline" (registered locally).
   * If a caller passes a different name they're responsible for
   * having registered it via registerMdiIcons in their own
   * module so wa-icon can resolve the path.
   */
  @property()
  icon = "alert-outline";

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

      /* Secondary sits between Cancel and Confirm when the caller
         passes a secondary-label. Visually neutral; the caller
         picks whether the destructive intent lives on the
         primary (Confirm) or the secondary slot via wording. */
      .btn--secondary {
        background: var(--wa-color-surface-lowered);
        color: var(--wa-color-text-normal);
        border: var(--wa-border-width-s) solid var(--wa-color-surface-border);
      }

      .btn--secondary:hover {
        background: var(--wa-color-surface-border);
      }
    `,
  ];

  private _decided = false;

  open() {
    this._decided = false;
    this._dialog.open = true;
  }

  close() {
    this._dialog.open = false;
  }

  protected render() {
    return html`
      <wa-dialog label=${this.heading} light-dismiss @wa-after-hide=${this._onAfterHide}>
        <div class="body">
          ${this.destructive
            ? html`<div class="icon-wrap destructive">
                <wa-icon library="mdi" name=${this.icon}></wa-icon>
              </div>`
            : nothing}
          <div class="text">
            <slot name="body">${this.message}</slot>
          </div>
        </div>
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
          ${this.secondaryLabel
            ? html`
                <button class="btn btn--secondary" @click=${this._secondary}>
                  ${this.secondaryLabel}
                </button>
              `
            : nothing}
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
    this._decided = true;
    this.close();
    // composed:false (omitted) so wrappers like
    // ``esphome-accept-peer-dialog`` that re-dispatch this event
    // with enriched detail don't see the *original* event keep
    // bubbling past the wrapper's shadow boundary and fire the
    // outer parent's handler a second time without our detail.
    // Same reasoning applies to ``secondary`` and ``cancel`` below.
    this.dispatchEvent(new CustomEvent("confirm", { bubbles: true }));
  }

  private _secondary() {
    this._decided = true;
    this.close();
    this.dispatchEvent(new CustomEvent("secondary", { bubbles: true }));
  }

  private _onAfterHide() {
    if (!this._decided) {
      this.dispatchEvent(new CustomEvent("cancel", { bubbles: true }));
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-confirm-dialog": ESPHomeConfirmDialog;
  }
}
