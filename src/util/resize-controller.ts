import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Reactive controller wrapping a ``ResizeObserver`` over the host
 * element: ``onResize`` fires whenever the host's box changes.
 * Observation follows the host's connect/disconnect lifecycle.
 */
export class ResizeController implements ReactiveController {
  private _observer: ResizeObserver;

  constructor(
    private readonly _host: ReactiveControllerHost & Element,
    onResize: () => void
  ) {
    this._observer = new ResizeObserver(onResize);
    _host.addController(this);
  }

  hostConnected(): void {
    this._observer.observe(this._host);
  }

  hostDisconnected(): void {
    this._observer.disconnect();
  }
}
