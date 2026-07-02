import { consume } from "@lit/context";
import { mdiAlertOutline } from "@mdi/js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { modalDialogStyles } from "../styles/modal-dialog.js";
import { espHomeStyles } from "../styles/shared.js";
import { EnterController } from "../util/enter-controller.js";
import { registerMdiIcons } from "../util/register-icons.js";

import "@home-assistant/webawesome/dist/components/icon/icon.js";
import "./base-dialog.js";

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

  @state()
  private _open = false;

  static styles = [
    espHomeStyles,
    modalDialogStyles,
    css`
      esphome-base-dialog {
        /* Hosts can widen a specific dialog (e.g. one showing long secret
           keys) by setting --esphome-confirm-dialog-width on the element. */
        --width: var(--esphome-confirm-dialog-width, 420px);
      }

      .icon-wrap.destructive {
        background: color-mix(in srgb, var(--esphome-error), transparent 88%);
        color: var(--esphome-error);
      }

      .icon-wrap:not(.destructive) {
        background: var(--esphome-tint);
        color: var(--esphome-primary);
      }

      .btn--confirm {
        background: var(--esphome-primary);
        color: var(--esphome-on-primary);
      }

      .btn--confirm:hover {
        background: var(--esphome-primary-hover);
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

  // Enter confirms, but never a destructive prompt (a stray Enter must not delete).
  private _enter = new EnterController(this, () => {
    if (!this.destructive) this._confirm();
  });

  open() {
    this._decided = false;
    this._open = true;
    this._enter.set(true);
  }

  close() {
    this._open = false;
  }

  protected render() {
    return html`
      <esphome-base-dialog
        ?open=${this._open}
        .label=${this.heading}
        @request-close=${this._onRequestClose}
        @after-hide=${this._onAfterHide}
      >
        <div class="body">
          ${
            this.destructive
              ? html`<div class="icon-wrap destructive">
                  <wa-icon library="mdi" name=${this.icon}></wa-icon>
                </div>`
              : nothing
          }
          <div class="text">
            <slot name="body">${this.message}</slot>
          </div>
        </div>
        <div class="actions">
          <button class="btn btn--cancel" @click=${this.close}>
            ${this._localize("layout.cancel")}
          </button>
          ${
            this.secondaryLabel
              ? html`
                  <button class="btn btn--secondary" @click=${this._secondary}>
                    ${this.secondaryLabel}
                  </button>
                `
              : nothing
          }
          <button
            class="btn btn--confirm ${this.destructive ? "destructive" : ""}"
            @click=${this._confirm}
          >
            ${this.confirmLabel || this.heading}
          </button>
        </div>
      </esphome-base-dialog>
    `;
  }

  private _confirm() {
    if (this._decided) return; // a repeated Enter must not dispatch twice
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

  // Flip _open the moment a close is requested (X / Esc / outside-click),
  // before wa-dialog finishes hiding, so a re-render can't re-assert ?open
  // and cancel the in-progress hide. Teardown stays in after-hide.
  private _onRequestClose = (): void => {
    this._open = false;
  };

  private _onAfterHide() {
    this._open = false;
    this._enter.set(false);
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
