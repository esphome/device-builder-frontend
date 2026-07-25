import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Inactivity watchdog: flags ``quiet`` when no activity lands for
 * *timeoutMs* while armed.
 *
 * The host arms it around the stream it watches and reports each unit of
 * activity; the window restarts on every report, so a healthy stream never
 * goes quiet. When the window elapses ``quiet`` flips true with a host
 * update. Disarmed, activity is ignored and ``quiet`` is false.
 *
 * activity() is hot-path safe: it only stamps a timestamp. The single
 * pending timeout re-checks the stamp when it fires and re-arms for the
 * remainder, so a line flood costs no timer churn.
 */
export class QuietTimerController implements ReactiveController {
  private _handle: ReturnType<typeof setTimeout> | null = null;
  private _lastActivity = 0;
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

  // Armed means a window is pending or has already gone quiet; disarmed is
  // the only state with neither.
  private get _armed(): boolean {
    return this._handle !== null || this._quiet;
  }

  /** Arm if not already armed; an armed window keeps its current deadline. */
  ensureArmed(): void {
    if (this._armed) return;
    this._lastActivity = Date.now();
    this._schedule(this._timeoutMs);
  }

  /** Restart the window and clear ``quiet``. No-op while disarmed. */
  activity(): void {
    if (!this._armed) return;
    this._lastActivity = Date.now();
    if (this._handle === null) this._schedule(this._timeoutMs);
    this._setQuiet(false);
  }

  disarm(): void {
    this._clear();
    this._setQuiet(false);
  }

  private _schedule(delayMs: number): void {
    this._handle = setTimeout(() => {
      const remaining = this._lastActivity + this._timeoutMs - Date.now();
      if (remaining > 0) {
        this._schedule(remaining);
        return;
      }
      this._handle = null;
      this._setQuiet(true);
    }, delayMs);
  }

  private _clear(): void {
    if (this._handle !== null) {
      clearTimeout(this._handle);
      this._handle = null;
    }
  }

  private _setQuiet(quiet: boolean): void {
    if (this._quiet === quiet) return;
    this._quiet = quiet;
    this._host.requestUpdate();
  }
}
