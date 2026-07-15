import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type { PairingWindowState } from "../api/types/remote-build.js";
import { remainingOf } from "./relative-time.js";

interface PairingWindowControllerOptions {
  getApi: () => ESPHomeAPI | undefined;
  /**
   * Open the window on host connect and release it on disconnect — the
   * settings-inbox shape where being on the screen *is* the pairing intent.
   * Persistent surfaces (the remote-build panel) leave this off and call
   * :meth:`open` from an explicit button instead.
   */
  autoOpen?: boolean;
  onOpenFailed?: () => void;
  onExtendFailed?: () => void;
}

/**
 * Owns the receiver pairing-window lifecycle for a host component.
 *
 * Bundles the open/extend/close API calls with the 1 Hz countdown that keeps
 * the M:SS chip fresh between ``remote_build_pairing_window_changed`` events.
 * The host feeds context pushes through :meth:`onStateChanged` and reads
 * :meth:`remainingSeconds` at render time.
 *
 * On disconnect the controller releases the window only when this host
 * actually opened it (``autoOpen`` goes through the same :meth:`open`, so a
 * failed auto-open claims nothing) — the server refcounts opens per WS
 * client and its idle timer is the safety net, so a host that never opened
 * the window can't close one another surface is holding.
 */
export class PairingWindowController implements ReactiveController {
  private _baselineSeconds: number | null = null;
  private _anchorMs = 0;
  private _tickHandle: ReturnType<typeof setInterval> | null = null;
  private _openedHere = false;
  private _autoOpenPending = false;
  private _tickSuspended = false;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _opts: PairingWindowControllerOptions
  ) {
    _host.addController(this);
  }

  hostConnected(): void {
    if (this._opts.autoOpen) this._autoOpen();
  }

  hostUpdated(): void {
    // The api context can land a tick after hostConnected; retry then.
    if (this._autoOpenPending) this._autoOpen();
  }

  hostDisconnected(): void {
    this._stopTick();
    this._autoOpenPending = false;
    if (this._openedHere) {
      this._openedHere = false;
      void this._opts
        .getApi()
        ?.setRemoteBuildPairingWindow({ open: false })
        .catch(() => {
          // Idle timer is the safety net.
        });
    }
  }

  /** Feed the context-provided window state; (re)seeds the countdown. */
  onStateChanged(state: PairingWindowState | null): void {
    if (state?.open && state.expires_in_seconds !== null) {
      this._baselineSeconds = state.expires_in_seconds;
      this._anchorMs = Date.now();
      this._startTick();
    } else {
      this._baselineSeconds = null;
      this._stopTick();
      // Closed (expired, or another tab closed it): nothing left to release.
      if (state !== null && !state.open) this._openedHere = false;
    }
  }

  open(): void {
    const api = this._opts.getApi();
    if (api === undefined) {
      // Shouldn't happen (apiContext resolves before hosts mount), but a
      // click must never be dropped without feedback.
      this._opts.onOpenFailed?.();
      return;
    }
    this._openedHere = true;
    void api.setRemoteBuildPairingWindow({ open: true }).catch(() => {
      this._openedHere = false;
      this._opts.onOpenFailed?.();
    });
  }

  extend(): void {
    const api = this._opts.getApi();
    if (api === undefined) {
      this._opts.onExtendFailed?.();
      return;
    }
    void api.setRemoteBuildPairingWindow({ open: true }).catch(() => {
      this._opts.onExtendFailed?.();
    });
  }

  remainingSeconds(): number | null {
    return remainingOf(this._baselineSeconds, this._anchorMs, Date.now());
  }

  /** Pause the 1 Hz countdown re-render while its chip isn't visible
   *  (collapsed panel). State pushes keep flowing so the baseline stays
   *  correctly anchored; only the display tick stops. */
  setTickSuspended(suspended: boolean): void {
    this._tickSuspended = suspended;
    if (suspended) this._stopTick();
    else if (this._baselineSeconds !== null) this._startTick();
  }

  /** Mount-time open: no user click behind it, so an unresolved api isn't
   *  a failure — park and retry from :meth:`hostUpdated` instead. */
  private _autoOpen(): void {
    if (this._opts.getApi() === undefined) {
      this._autoOpenPending = true;
      return;
    }
    this._autoOpenPending = false;
    this.open();
  }

  private _startTick(): void {
    if (this._tickSuspended || this._tickHandle !== null) return;
    this._tickHandle = setInterval(() => {
      this._host.requestUpdate();
    }, 1000);
  }

  private _stopTick(): void {
    if (this._tickHandle !== null) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
  }
}
