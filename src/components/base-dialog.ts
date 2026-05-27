import "@home-assistant/webawesome/dist/components/dialog/dialog.js";

import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";

import { dialogCloseButtonStyles } from "../styles/dialog-close-button.js";

/**
 * Thin shared wrapper around ``<wa-dialog>``.
 *
 * Every dialog in the app spent ~20 lines on identical
 * scaffolding — the ``?open`` binding, the
 * ``?light-dismiss`` busy-gate, the ``@wa-request-close``
 * / ``@wa-after-hide`` wiring, and ``dialogCloseButtonStyles``
 * to dress the built-in close button. This element bundles
 * all of that into one place so consumers carry just the
 * dialog title and body.
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
 * - The wrapper proactively ``preventDefault()``s
 *   ``wa-request-close`` so Escape / X-button click /
 *   programmatic close are all silently absorbed, even
 *   when the consumer doesn't wire their own
 *   ``@request-close`` veto handler. The busy gate is
 *   comprehensive — consumers don't have to double-cover
 *   it.
 * - The built-in close button is visually dimmed via
 *   ``:host([busy]) wa-dialog::part(close-button__base)``
 *   so the silent absorption doesn't read as a broken
 *   button.
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
 * - Escape key / outside-click / built-in X button →
 *   ``wa-dialog`` fires ``wa-request-close`` directly.
 * - Reactive ``?open`` flip from the host → ``wa-dialog``
 *   fires ``wa-request-close`` as part of its hide
 *   sequence.
 *
 * The wrapper never mutates its own ``open`` property in
 * response to user actions. After a non-vetoed close,
 * wa-dialog finishes hiding and fires ``wa-after-hide``;
 * the host's ``@after-hide`` listener is the place to
 * flip ``_open = false`` and clear local state, which
 * flows back through the reactive ``?open`` binding so
 * the next render's ``?open`` matches.
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
 *
 * **Part forwarding**. The inner ``<wa-dialog>`` is wrapped
 * in this element's shadow DOM, so consumer styles that
 * targeted ``wa-dialog::part(...)`` directly won't reach
 * through. ``exportparts="..."`` on the inner element
 * re-exposes the parts under the same names, addressable
 * from a migrating consumer as
 * ``esphome-base-dialog::part(header)`` etc. The
 * forwarded parts are the ones currently overridden across
 * the codebase: ``dialog``, ``header``, ``title``, ``body``,
 * ``footer``, ``close-button``, ``close-button__base``.
 * Consumers swap ``wa-dialog::part(X)`` →
 * ``esphome-base-dialog::part(X)`` at migration time.
 */
@customElement("esphome-base-dialog")
export class ESPHomeBaseDialog extends LitElement {
  /** Dialog title rendered in the header. Consumers pass
   *  the already-localised string. */
  @property() label = "";

  /** Reactive open flag. Bind to your component's open
   *  state and the dialog opens / closes accordingly. */
  @property({ type: Boolean }) open = false;

  /** When ``true``: light-dismiss is disabled and the
   *  close-button is greyed out. Use for "WS round-trip in
   *  flight; don't let the user orphan it".
   *
   *  Reflected to the ``busy`` attribute so the
   *  ``:host([busy])`` CSS selector matches regardless of
   *  whether the host binds via boolean-attribute syntax
   *  (``?busy=${...}``), property syntax (``.busy=${...}``),
   *  or imperative assignment (``dialog.busy = true``).
   *  Without ``reflect: true``, only the boolean-attribute
   *  form would update the attribute, so property /
   *  imperative writers would get the functional gate
   *  (wa-request-close veto) but not the visual dim on the
   *  close button. */
  @property({ type: Boolean, reflect: true }) busy = false;

  private _onWaRequestClose = (e: Event): void => {
    // ``wa-dialog``'s events bubble + compose, so the same
    // event type fired by a nested ``wa-dialog`` (e.g. an
    // ``esphome-confirm-dialog`` inside our slotted body)
    // bubbles up here and would otherwise close this dialog
    // too. Filter to events whose ``currentTarget`` is our
    // own wa-dialog before reacting.
    if (e.target !== e.currentTarget) return;
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

  private _onWaAfterHide = (e: Event): void => {
    // Same nested-wa-dialog leak as ``_onWaRequestClose``:
    // ignore ``wa-after-hide`` events that came from a
    // descendant ``wa-dialog`` rather than our own.
    if (e.target !== e.currentTarget) return;
    this.dispatchEvent(
      new CustomEvent("after-hide", { bubbles: false, composed: false })
    );
  };

  protected render() {
    return html`
      <wa-dialog
        exportparts="dialog,header,title,body,footer,close-button,close-button__base"
        ?open=${this.open}
        ?light-dismiss=${!this.busy}
        @wa-request-close=${this._onWaRequestClose}
        @wa-after-hide=${this._onWaAfterHide}
      >
        <header slot="label">${this.label}</header>
        <slot></slot>
      </wa-dialog>
    `;
  }

  static styles = [
    dialogCloseButtonStyles,
    css`
      :host {
        display: contents;

        /* Alias the consumer-set --width into a wrapper-
           private name. wa-dialog declares
           :host { --width: 31rem } in its own shadow
           root, and a property's :host declaration beats
           inherited values from outside the shadow tree
           per the CSS Scoping spec — so a consumer's
           --width on this wrapper would be silently
           clobbered by wa-dialog's default and the
           dialog would always render at 31rem regardless
           of what the consumer asked for. Forwarding via
           an internal name + an external selector on the
           inner wa-dialog (below) is the only CSS-only
           way to make the consumer's --width win the
           cascade race. */
        --base-dialog-width: var(--width, 31rem);
      }

      /* External author rule from the wrapper's shadow
         root targeting the inner wa-dialog. External
         declarations beat the inner shadow root's :host
         default, so this is where the consumer's
         --width finally lands as wa-dialog's effective
         width. */
      wa-dialog {
        --width: var(--base-dialog-width);
      }

      /* Busy visual on wa-dialog's built-in close. The
         functional gate is the wa-request-close veto
         above — clicking the X while busy silently
         absorbs the event and the dialog stays open. The
         CSS here is the user-facing cue (button looks
         disabled) so the silent absorption doesn't read
         as a broken button. */
      :host([busy]) wa-dialog::part(close-button__base) {
        opacity: 0.4;
        cursor: not-allowed;
        pointer-events: none;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "esphome-base-dialog": ESPHomeBaseDialog;
  }
}
