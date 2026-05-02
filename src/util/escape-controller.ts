import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Reactive controller that runs ``onEscape`` whenever the user presses
 * Escape, but only while the controller is "active". Components that
 * own a popup or drawer call ``set(open)`` from ``willUpdate`` so the
 * window listener attaches when the surface opens and detaches when it
 * closes — no leaks, no extra bookkeeping in each component.
 *
 * Hooking up via Lit's ``addController`` means the listener is also
 * dropped automatically when the host disconnects, even if the host
 * never explicitly calls ``set(false)``.
 */
export class EscapeController implements ReactiveController {
  private _bound = false;

  constructor(
    host: ReactiveControllerHost,
    private readonly onEscape: () => void,
  ) {
    host.addController(this);
  }

  hostDisconnected() {
    this.set(false);
  }

  set(active: boolean) {
    if (active === this._bound) return;
    if (active) {
      window.addEventListener("keydown", this._handler);
    } else {
      window.removeEventListener("keydown", this._handler);
    }
    this._bound = active;
  }

  private _handler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      this.onEscape();
    }
  };
}
