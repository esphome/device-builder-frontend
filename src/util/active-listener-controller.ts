import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Base for a controller whose listeners are bound only while the host says
 * it is active (``set``) and is connected; a host reconnected while still
 * active is bound again.
 */
export abstract class ActiveListenerController implements ReactiveController {
  private _active = false;
  private _bound = false;
  // Lit keeps updating a host that was detached after its first connect,
  // so ``set`` can arrive while detached. Connected until told otherwise,
  // for hosts that never report a connect.
  private _connected = true;

  constructor(host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {
    this._connected = true;
    this._sync();
  }

  hostDisconnected(): void {
    this._connected = false;
    this._sync();
  }

  set(active: boolean): void {
    this._active = active;
    this._sync();
  }

  protected abstract bind(): void;
  protected abstract unbind(): void;

  private _sync(): void {
    const bound = this._active && this._connected;
    if (bound === this._bound) return;
    if (bound) this.bind();
    else this.unbind();
    this._bound = bound;
  }
}
