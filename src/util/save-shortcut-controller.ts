import type { ReactiveController, ReactiveControllerHost } from "lit";

export interface SaveShortcutControllerOptions {
  /** Where to bind the keydown listener. Defaults to ``window`` so the
   *  shortcut fires regardless of which child (CodeMirror, form inputs)
   *  holds focus. Accepts any ``EventTarget`` so tests can inject a stub. */
  target?: EventTarget;
}

/**
 * Reactive controller that runs ``onSave`` on Cmd/Ctrl+S, swallowing the
 * browser's "save page" default while the host is connected.
 *
 * ``preventDefault`` fires on every match (so the browser dialog never
 * appears on an editor page); ``onSave`` decides whether anything is dirty.
 */
export class SaveShortcutController implements ReactiveController {
  private _bound = false;
  private readonly _target: EventTarget;

  constructor(
    host: ReactiveControllerHost,
    private readonly onSave: () => void,
    options: SaveShortcutControllerOptions = {}
  ) {
    this._target = options.target ?? window;
    host.addController(this);
  }

  hostConnected() {
    if (this._bound) return;
    this._target.addEventListener("keydown", this._handler);
    this._bound = true;
  }

  hostDisconnected() {
    if (!this._bound) return;
    this._target.removeEventListener("keydown", this._handler);
    this._bound = false;
  }

  /* Typed as EventListener so the union of Window | Document accepts the
     registration; the cast is local and callers get a real KeyboardEvent. */
  private _handler: EventListener = (e) => {
    const ke = e as KeyboardEvent;
    if (
      !(ke.metaKey || ke.ctrlKey) ||
      ke.altKey ||
      ke.shiftKey ||
      ke.key.toLowerCase() !== "s"
    ) {
      return;
    }
    // Bail if a deeper handler already claimed this Cmd+S, so two co-active
    // controllers on the same target don't both fire (mirrors EnterController).
    if (ke.defaultPrevented) return;
    ke.preventDefault();
    this.onSave();
  };
}
