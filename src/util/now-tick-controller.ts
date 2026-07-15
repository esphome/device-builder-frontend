import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Coarse wall-clock ticker for live relative-time strings ("started 2m ago").
 *
 * ``now`` re-anchors on :meth:`start` and advances every *intervalMs*,
 * requesting a host update per tick. Hosts that are only sometimes visible
 * (dialogs) start/stop around open/close; always-visible hosts pass
 * ``autoStart`` and let ``hostConnected``/``hostDisconnected`` drive it.
 */
export class NowTickController implements ReactiveController {
  private _now = Date.now();
  private _handle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _opts: { intervalMs?: number; autoStart?: boolean } = {}
  ) {
    _host.addController(this);
  }

  hostConnected(): void {
    if (this._opts.autoStart) this.start();
  }

  hostDisconnected(): void {
    this.stop();
  }

  get now(): number {
    return this._now;
  }

  /** Idempotent while running; a stopped ticker re-anchors ``now`` on start. */
  start(): void {
    if (this._handle !== null) return;
    this._now = Date.now();
    this._host.requestUpdate();
    this._handle = setInterval(() => {
      this._now = Date.now();
      this._host.requestUpdate();
    }, this._opts.intervalMs ?? 30_000);
  }

  stop(): void {
    if (this._handle !== null) {
      clearInterval(this._handle);
      this._handle = null;
    }
  }
}
