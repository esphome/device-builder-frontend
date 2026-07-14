import type { ReactiveController, ReactiveControllerHost } from "lit";
import { EscapeController } from "./escape-controller.js";

export interface LightDismissOptions {
  /** Composed-path root treated as "inside" — clicks within it don't
   *  dismiss. Defaults to the host element. A callback so it can resolve
   *  a render-root node that only exists while the popover is open;
   *  returning ``null``/``undefined`` makes every click dismiss. */
  container?: () => Element | null | undefined;
  /** Where the Escape listener binds; see ``EscapeControllerOptions``. */
  escapeTarget?: EventTarget;
  /** Bind Escape in the capture phase (claim it ahead of a hosting
   *  dialog's own Escape handling). */
  escapeCapture?: boolean;
  /** Pre-dismiss Escape hook: how to claim the event (default
   *  ``preventDefault``) plus per-site extras like ``stopPropagation``
   *  or returning focus to the trigger. Dismissal always follows. */
  onEscape?: (e: KeyboardEvent) => void;
}

/**
 * Light dismissal for a hand-rolled popover: while active, a click
 * outside the container or an Escape press invokes ``onDismiss``. The
 * host owns the open flag and calls ``set(open)`` (typically from
 * ``willUpdate``), mirroring :class:`EscapeController` — which handles
 * the Escape half here.
 *
 * The click listener binds capture-phase on ``document`` so a
 * ``stopPropagation`` inside the popover can't defeat dismissal, and it
 * binds only while active, so the click that opened the popover (whose
 * capture phase has already run by the time the host flips the flag)
 * can't self-dismiss it.
 */
export class LightDismissController implements ReactiveController {
  private _bound = false;
  private readonly _escape: EscapeController;

  constructor(
    private readonly _host: ReactiveControllerHost & Element,
    private readonly _onDismiss: () => void,
    private readonly _options: LightDismissOptions = {}
  ) {
    this._escape = new EscapeController(
      _host,
      (e) => {
        if (_options.onEscape) _options.onEscape(e);
        else e.preventDefault();
        _onDismiss();
      },
      { target: _options.escapeTarget, capture: _options.escapeCapture }
    );
    _host.addController(this);
  }

  hostDisconnected(): void {
    this.set(false);
  }

  set(active: boolean): void {
    this._escape.set(active);
    if (active === this._bound) return;
    if (active) {
      document.addEventListener("click", this._onDocumentClick, true);
    } else {
      document.removeEventListener("click", this._onDocumentClick, true);
    }
    this._bound = active;
  }

  private _onDocumentClick = (e: MouseEvent): void => {
    const container = this._options.container ? this._options.container() : this._host;
    if (container && e.composedPath().includes(container)) return;
    this._onDismiss();
  };
}
