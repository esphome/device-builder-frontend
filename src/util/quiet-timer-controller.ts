import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Inactivity watchdog: flags ``quiet`` when no activity lands for
 * *timeoutMs* while armed.
 *
 * The host arms it around the stream it watches and reports each unit of
 * activity; the window restarts on every report, so a healthy stream never
 * goes quiet. When the window elapses ``quiet`` flips true with a host
 * update. Disarmed, activity is ignored and ``quiet`` is false.
 */
export class QuietTimerController implements ReactiveController {
  private _handle: ReturnType<typeof setTimeout> | null = null;
  private _quiet = false;
  private _armed = false;

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

  /** Arm if not already armed; an armed window keeps its current deadline. */
  ensureArmed(): void {
    if (this._armed) return;
    this._armed = true;
    this._start();
  }

  /** Restart the window and clear ``quiet``. No-op while disarmed. */
  activity(): void {
    if (!this._armed) return;
    this._start();
    this._setQuiet(false);
  }

  disarm(): void {
    this._armed = false;
    this._clear();
    this._setQuiet(false);
  }

  private _start(): void {
    this._clear();
    this._handle = setTimeout(() => {
      this._handle = null;
      this._setQuiet(true);
    }, this._timeoutMs);
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
