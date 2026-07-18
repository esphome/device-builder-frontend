import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Owns the reactive open flag for an ``esphome-base-dialog`` host with no
 * close-veto logic.
 *
 * Every state-driven consumer of the wrapper used to carry the same three
 * pieces: an ``@state() _open`` field, a ``?open=${this._open}`` binding, and
 * a copy-pasted trivial handler
 * ``private _onRequestClose = () => { this._open = false; }``. This
 * controller bundles the flag and the handler so the host binds
 * ``?open=${this._dialog.open}`` /
 * ``@request-close=${this._dialog.onRequestClose}`` and the boilerplate
 * disappears.
 *
 * ``onRequestClose`` flips ``open`` the moment a close is requested
 * (Escape / X / outside-click), before wa-dialog finishes hiding, so a host
 * re-render can't re-assert ``?open`` and cancel the in-progress hide —
 * ``esphome-base-dialog`` never mutates its own ``open`` on a user-driven
 * close, the host owns the flag (see the wrapper's class docs). Hosts that
 * sync on the wrapper's ``@after-hide`` re-emit instead bind
 * ``onAfterHide``.
 *
 * Dialogs with a real veto (busy guard, unsaved-changes prompt) keep their
 * own ``@request-close`` handler instead; the trivial flip here never
 * ``preventDefault()``s.
 */
export class DialogOpenController implements ReactiveController {
  private _open = false;

  constructor(private readonly _host: ReactiveControllerHost) {
    _host.addController(this);
  }

  // Intentionally empty. ``ReactiveController``'s hooks are all optional,
  // which makes it a weak type: TypeScript rejects a class sharing no
  // members with it (TS2559 at ``implements``, TS2345 at
  // ``addController(this)``), so one no-op hook must stay.
  hostConnected(): void {}

  get open(): boolean {
    return this._open;
  }

  set open(value: boolean) {
    if (value === this._open) return;
    this._open = value;
    this._host.requestUpdate();
  }

  /** The trivial ``@request-close`` handler: flip the flag, veto nothing. */
  readonly onRequestClose = (): void => {
    this.open = false;
  };

  /** The trivial ``@after-hide`` handler — the wrapper re-emits it for every
   *  dismissal path (Esc / outside-click / X / reactive ``?open`` flip). */
  readonly onAfterHide = (): void => {
    this.open = false;
  };
}
