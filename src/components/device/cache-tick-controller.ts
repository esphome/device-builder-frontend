import type { ReactiveController, ReactiveControllerHost } from "lit";

type Subscribe = (callback: () => void) => () => void;

/**
 * Subscribes to one or more shared caches and bumps a version on any
 * update, requesting a host re-render. ``tick`` is a stable memo
 * invalidation key; the controller owns the subscribe/unsubscribe
 * lifecycle so the host needs no connected/disconnected plumbing.
 */
export class CacheTickController implements ReactiveController {
  private _tick = 0;
  private _unsubscribes: Array<() => void> = [];

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _subscribes: Subscribe[]
  ) {
    _host.addController(this);
  }

  get tick(): number {
    return this._tick;
  }

  hostConnected(): void {
    this._unsubscribes = this._subscribes.map((subscribe) =>
      subscribe(() => {
        this._tick++;
        this._host.requestUpdate();
      })
    );
  }

  hostDisconnected(): void {
    for (const unsubscribe of this._unsubscribes) unsubscribe();
    this._unsubscribes = [];
  }
}
