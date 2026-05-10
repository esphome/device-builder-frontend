import "@home-assistant/webawesome/dist/components/dialog/dialog.js";

import { consume } from "@lit/context";
import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";

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
 *   outside-click can't dismiss while a WS round-trip is
 *   in flight.
 * - The close-button is ``disabled``.
 * - The wrapper proactively ``preventDefault()``s
 *   ``wa-request-close`` so Escape / programmatic close
 *   are blocked too, even when the consumer doesn't wire
 *   their own ``@request-close`` veto handler. The busy
 *   gate is comprehensive — consumers don't have to
 *   double-cover it.
 *
 * **Events re-emitted**:
 *
 * - ``@request-close`` mirrors ``wa-dialog``'s
 *   ``wa-request-close`` (cancellable; ``preventDefault()``
 *   to veto for host-side reasons like unsaved changes).
 *   Not fired when the wrapper vetoes for ``busy`` — the
 *   host can't override the busy gate.
 * - ``@after-hide`` mirrors ``wa-dialog``'s
 *   ``wa-after-hide`` (fires once the dialog has fully
 *   hidden; consumers reset local state and flip their
 *   own ``_open = false`` here so the next render's
 *   ``?open`` binding matches the wrapper's state).
 *
 * **Close paths**:
 *
 * All close paths flow through ``wa-request-close`` so
 * busy gate + host veto are evaluated uniformly:
 *
 * - Escape key / outside-click → ``wa-dialog`` fires
 *   ``wa-request-close`` directly.
 * - Custom X button click → wrapper calls
 *   ``waDialog.hide()`` which fires ``wa-request-close``.
 * - Reactive ``?open`` flip → ``wa-dialog`` fires
 *   ``wa-request-close`` as part of its hide sequence.
 *
 * The wrapper never mutates its own ``open`` property in
 * response to user actions; closing is the host's
 * responsibility via ``?open=${false}`` (typically wired
 * inside the ``@after-hide`` listener). This keeps a
 * single source of truth on the host so a re-render
 * mid-close can't reopen the dialog.
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

  @query("wa-dialog")
  private _waDialog?: HTMLElement & { hide?: () => void };

  private _onWaRequestClose = (e: Event): void => {
    // Busy gate first: refuse close regardless of source
    // (Esc / outside-click / X / programmatic) while a WS
    // round-trip is in flight. Consumers don't have to
    // wire their own veto — the wrapper handles it.
    if (this.busy) {
      e.preventDefault();
      return;
    }
    // Re-emit as ``request-close`` so host can veto for
    // its own reasons (unsaved changes, mid-step flow,
    // …). preventDefault() on the re-emitted event
    // vetoes the close on the underlying wa-dialog too.
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
    // Drive close through wa-dialog's hide() so the entire
    // close flow (busy gate via wa-request-close + host
    // veto + after-hide cleanup) runs uniformly. Mutating
    // ``this.open`` directly would (a) bypass the host's
    // veto opportunity and (b) desync with a state-driven
    // host whose own ``_open`` is still true — a host
    // re-render mid-close would flip ``?open`` back to
    // true and re-open the dialog.
    this._waDialog?.hide?.();
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
