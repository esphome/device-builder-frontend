import type { ReactiveController, ReactiveControllerHost } from "lit";

export interface EnterControllerOptions {
  /** Where to bind the keydown listener. Defaults to ``window``. Accepts
   *  any ``EventTarget`` so tests can inject a stub. */
  target?: EventTarget;
}

// Elements that act on Enter themselves. When focus sits on one of these
// we leave Enter alone: a focused button/link activates natively (so the
// controller mustn't also fire the primary action and double-act), and a
// textarea / select / editable region needs Enter for its own input.
const SELF_HANDLING = new Set(["BUTTON", "A", "TEXTAREA", "SELECT"]);

/**
 * Reactive controller that runs ``onEnter`` when the user presses Enter
 * while the controller is "active". Dialogs call ``set(open)`` so the
 * listener attaches on open and detaches on close — the shared
 * counterpart to :class:`EscapeController` for confirming a dialog from
 * the keyboard instead of duplicating a keydown handler per dialog.
 *
 * Enter is ignored when a modifier is held, while an IME composition is
 * in flight, when a deeper handler already claimed it (``defaultPrevented``),
 * or when focus is on an element that handles Enter itself (button, link,
 * textarea, select, contenteditable). The callback receives the raw event.
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
    if (ke.ctrlKey || ke.metaKey || ke.altKey) return;
    if (ke.defaultPrevented) return;
    // composedPath()[0] pierces shadow DOM to the real focused element,
    // which document.activeElement can't see across roots.
    const el = ke.composedPath()[0] as HTMLElement | undefined;
    if (el) {
      if (SELF_HANDLING.has(el.tagName)) return;
      if (el.isContentEditable) return;
    }
    this.onEnter(ke);
  };
}
