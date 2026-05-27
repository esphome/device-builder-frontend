import type { ReactiveController, ReactiveControllerHost } from "lit";

export interface EscapeControllerOptions {
  /** Where to bind the keydown listener. Defaults to ``window``. Use
   *  ``document`` when the host needs to ``stopPropagation`` so an
   *  ancestor (a dialog wrapping a popup, for example) doesn't also
   *  swallow the same Escape. Accepts any ``EventTarget`` so tests can
   *  inject a stub. */
  target?: EventTarget;
}

/**
 * Reactive controller that runs ``onEscape`` whenever the user presses
 * Escape, but only while the controller is "active". Components that
 * own a popup or drawer call ``set(open)`` from ``willUpdate`` so the
 * listener attaches when the surface opens and detaches when it
 * closes — no leaks, no extra bookkeeping in each component.
 *
 * The callback receives the raw event so the caller decides whether to
 * ``preventDefault`` / ``stopPropagation`` (semantics differ across
 * use sites: a dropdown nested in a dialog wants to stop propagation
 * so the dialog doesn't also close, while a top-level drawer just
 * wants to swallow the default).
 *
 * Hooking up via Lit's ``addController`` means the listener is also
 * dropped automatically when the host disconnects, even if the host
 * never explicitly calls ``set(false)``.
 */
export class EscapeController implements ReactiveController {
  private _bound = false;
  private readonly _target: EventTarget;

  constructor(
    host: ReactiveControllerHost,
    private readonly onEscape: (e: KeyboardEvent) => void,
    options: EscapeControllerOptions = {}
  ) {
    this._target = options.target ?? window;
    host.addController(this);
  }

  hostDisconnected() {
    this.set(false);
  }

  set(active: boolean) {
    if (active === this._bound) return;
    if (active) {
      this._target.addEventListener("keydown", this._handler);
    } else {
      this._target.removeEventListener("keydown", this._handler);
    }
    this._bound = active;
  }

  /* Typed as EventListener so the union of Window | Document accepts
     the registration (each addEventListener overload narrows on the
     event-name argument; the union loses that narrowing). The cast is
     local — callers receive a properly typed KeyboardEvent. */
  private _handler: EventListener = (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key !== "Escape") return;
    /* Bail if a deeper handler already claimed this Escape (typically
       by calling preventDefault). Each callback in this codebase
       preventDefaults, so when multiple surfaces happen to be open at
       once only the first listener to fire actually closes. Without
       this guard a single Esc press would close every overlay
       unintentionally. */
    if (ke.defaultPrevented) return;
    this.onEscape(ke);
  };
}
