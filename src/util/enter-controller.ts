import type { ReactiveController, ReactiveControllerHost } from "lit";

export interface EnterControllerOptions {
  /** Where to bind the keydown listener. Defaults to ``window``. Accepts
   *  any ``EventTarget`` so tests can inject a stub. */
  target?: EventTarget;
}

// Focus on one of these means Enter is already spoken for: a button/link
// activates natively, a textarea/select needs Enter for its own input.
const SELF_HANDLING = new Set(["BUTTON", "A", "TEXTAREA", "SELECT"]);

/**
 * Runs ``onEnter`` on a plain Enter while active — the keyboard counterpart
 * to :class:`EscapeController`, so dialogs confirm without duplicating a
 * keydown handler. Toggle with ``set(open)``.
 */
export class EnterController implements ReactiveController {
  private _bound = false;
  private readonly _target: EventTarget;

  constructor(
    host: ReactiveControllerHost,
    private readonly onEnter: (e: KeyboardEvent) => void,
    options: EnterControllerOptions = {}
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

  /* Typed as EventListener so Window | Document accepts the registration;
     the cast is local and callers get a real KeyboardEvent. */
  private _handler: EventListener = (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key !== "Enter") return;
    if (ke.isComposing || ke.keyCode === 229) return; // mid-IME composition
    if (ke.ctrlKey || ke.metaKey || ke.altKey || ke.shiftKey) return;
    // First active controller to act claims the event (preventDefault below);
    // a co-active one then bails here. Mirrors EscapeController. Single active
    // modal is load-bearing: "first" is window listener registration order
    // (open order), not z-order, so Enter routing is undefined if two stack.
    if (ke.defaultPrevented) return;
    // composedPath()[0] is the real focused element across shadow roots.
    const el = ke.composedPath()[0] as HTMLElement | undefined;
    if (el) {
      if (SELF_HANDLING.has(el.tagName)) return;
      if (el.isContentEditable) return;
    }
    ke.preventDefault(); // claim it so a co-active controller bails (see above)
    this.onEnter(ke);
  };
}
