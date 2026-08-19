import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * One-shot silence watchdog: flags ``quiet`` when *timeoutMs* elapses
 * after arming.
 *
 * The host arms it when the stream it watches starts and disarms it once
 * the stream has proven itself (or ends). When the window elapses ``quiet``
 * flips true with a host update. Disarmed, ``quiet`` is false.
 */
export class QuietTimerController implements ReactiveController {
  private _handle: ReturnType<typeof setTimeout> | null = null;
  private _quiet = false;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _timeoutMs: number
  ) {
    _host.addController(this);
  }

  hostDisconnected(): void {
    this.disarm();
  }

  get quiet(): boolean {
    return this._quiet;
  }

  /** Arm if not already armed (a window pending or already quiet); an armed
   *  window keeps its current deadline. */
  ensureArmed(): void {
    if (this._handle !== null || this._quiet) return;
    this._handle = setTimeout(() => {
      this._handle = null;
      this._setQuiet(true);
    }, this._timeoutMs);
  }

  disarm(): void {
    if (this._handle !== null) {
      clearTimeout(this._handle);
      this._handle = null;
    }
    this._setQuiet(false);
  }

  private _setQuiet(quiet: boolean): void {
    if (this._quiet === quiet) return;
    this._quiet = quiet;
    this._host.requestUpdate();
  }
}
