import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Base for a controller whose listeners are bound only while the host says
 * it is active (``set``) and is connected; a host reconnected while still
 * active is bound again.
 */
export abstract class ActiveListenerController implements ReactiveController {
  private _active = false;
  private _bound = false;

  constructor(host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {
    this._sync(this._active);
  }

  hostDisconnected(): void {
    this._sync(false);
  }

  set(active: boolean): void {
    this._active = active;
    this._sync(active);
  }

  protected abstract bind(): void;
  protected abstract unbind(): void;

  private _sync(bound: boolean): void {
    if (bound === this._bound) return;
    if (bound) this.bind();
    else this.unbind();
    this._bound = bound;
  }
}
