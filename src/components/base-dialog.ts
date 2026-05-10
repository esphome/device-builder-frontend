import "@home-assistant/webawesome/dist/components/dialog/dialog.js";

import { consume } from "@lit/context";
import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import type { LocalizeFunc } from "../common/localize.js";
import { localizeContext } from "../context/index.js";
import { dialogCloseButtonStyles } from "../styles/dialog-close-button.js";

/**
 * Thin shared wrapper around ``<wa-dialog>``.
 *
 * Every dialog in the app spent ~20 lines on identical
 * scaffolding — the ``?open`` binding, the
 * ``?light-dismiss`` busy-gate, the ``@wa-request-close``
 * / ``@wa-after-hide`` wiring, and a custom dialog-close X
 * button in ``slot="header-actions"`` with a disabled-when-
 * busy contract. This element bundles all of that into one
 * place so consumers carry just the dialog title and body.
 *
 * Reactive open/close: consumers pass ``?open=${this._open}``
 * and listen for ``@after-hide`` to clear local state. The
 * imperative ``dialog.open = true`` pattern some legacy
 * dialogs still use is incompatible with this wrapper —
 * those consumers should switch to a state-driven open flag
 * during migration.
 *
 * **Busy gate**. When ``?busy=true``:
 *
 * - ``<wa-dialog>``'s ``?light-dismiss`` is disabled, so
 *   outside-click / Esc can't dismiss while a WS round-trip
 *   is in flight.
 * - The close-button is ``disabled``.
 * - Hosts that want to *also* veto programmatic close
 *   (``dialog.close()`` from a parent) can still listen for
 *   ``@request-close`` and call ``e.preventDefault()`` on
 *   their own logic.
 *
 * **Events re-emitted**:
 *
 * - ``@request-close`` mirrors ``wa-dialog``'s
 *   ``wa-request-close`` (cancellable; ``preventDefault()``
 *   to veto).
 * - ``@after-hide`` mirrors ``wa-dialog``'s
 *   ``wa-after-hide`` (fires once the dialog has fully
 *   hidden; consumers reset local state here).
 *
 * **Slots**:
 *
 * - Default slot: dialog body. Consumers put their form
 *   fields, error banner, and actions row inline here.
 *   The wrapper doesn't impose a ``slot="footer"`` because
 *   most existing dialogs render the actions row as a
 *   plain ``<div class="actions">`` at the end of the
 *   body, and forcing them to migrate to a slotted footer
 *   would balloon the diff for no behaviour change.
 */
@customElement("esphome-base-dialog")
export class ESPHomeBaseDialog extends LitElement {
  @consume({ context: localizeContext, subscribe: true })
  @state()
  private _localize: LocalizeFunc = (key) => key;

  /** Dialog title rendered in the header. Consumers pass
   *  the already-localised string. */
  @property() label = "";

  /** Reactive open flag. Bind to your component's open
   *  state and the dialog opens / closes accordingly. */
  @property({ type: Boolean }) open = false;

  /** When ``true``: light-dismiss is disabled and the
   *  close-button is greyed out. Use for "WS round-trip in
   *  flight; don't let the user orphan it". */
  @property({ type: Boolean }) busy = false;

  private _onWaRequestClose = (e: Event): void => {
    // Re-emit as ``request-close``; preserve cancellation
    // semantics so a host that calls preventDefault() on
    // the re-emitted event vetoes the close on the
    // underlying wa-dialog too.
    const passthrough = new CustomEvent("request-close", {
      cancelable: true,
      bubbles: false,
      composed: false,
    });
    this.dispatchEvent(passthrough);
    if (passthrough.defaultPrevented) e.preventDefault();
  };

  private _onWaAfterHide = (): void => {
    this.dispatchEvent(
      new CustomEvent("after-hide", { bubbles: false, composed: false }),
    );
  };

  private _onCloseClick = (): void => {
    // Mirrors the explicit ``_close()`` handler every
    // consumer used to wire. wa-dialog's after-hide fires
    // afterwards so the host's state cleanup still runs
    // via the @after-hide listener.
    if (this.busy) return;
    this.open = false;
  };

  protected render() {
    return html`
      <wa-dialog
        ?open=${this.open}
        ?light-dismiss=${!this.busy}
        @wa-request-close=${this._onWaRequestClose}
        @wa-after-hide=${this._onWaAfterHide}
      >
        <header slot="label">${this.label}</header>
        <button
          class="dialog-close"
          slot="header-actions"
          aria-label=${this._localize("layout.close")}
          ?disabled=${this.busy}
          @click=${this._onCloseClick}
        >
          ✕
        </button>
        <slot></slot>
      </wa-dialog>
    `;
  }

  static styles = [
    dialogCloseButtonStyles,
    css`
      :host {
        display: contents;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-base-dialog": ESPHomeBaseDialog;
  }
}
