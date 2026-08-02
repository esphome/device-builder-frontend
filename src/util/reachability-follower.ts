/**
 * Shared follower for the per-device reachability stream.
 *
 * Owns the subscribe / reconnect / failure / teardown lifecycle:
 * generation-gated resubscribe across WS reconnects, a per
 * `${name}:${generation}` failure memo with a rate-limited warn, stale
 * attempt discard, and the 1 Hz reconcile tick. Hosts declare what to
 * follow through `deviceName()` (null means idle); reconcile runs
 * after every host update, and the interval arms and disarms itself
 * off the same signal.
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ESPHomeAPI } from "../api/esphome-api.js";
import type {
  ReachabilityStateEvent,
  ReachabilitySubscription,
} from "../api/types/reachability.js";

export interface ReachabilityFollowerOptions {
  api: () => ESPHomeAPI | undefined;
  /** Target to follow; null means idle (closed, hidden, untracked).
   *  Only consulted while `api()` is defined — no api means idle. */
  deviceName: () => string | null;
  onEvent: (state: ReachabilityStateEvent) => void;
  /** Fired when an active target is torn down. */
  onTeardown?: () => void;
  /** Request a host render each tick, for second-precision ages. */
  tickRender?: boolean;
}

export class ReachabilityFollower implements ReactiveController {
  private _subscription: ReachabilitySubscription | null = null;

  private _subscribedName: string | null = null;

  private _subscribedGeneration = 0;

  private _failedKey: string | null = null;

  private _loggedKey: string | null = null;

  private _interval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly _host: ReactiveControllerHost,
    private readonly _options: ReachabilityFollowerOptions
  ) {
    _host.addController(this);
  }

  hostConnected(): void {
    this.reconcile();
  }

  hostUpdated(): void {
    // Idempotent and two reads in the steady state, so following every
    // host update beats a hand-maintained trigger list that fails
    // silently when a relevant property is missed.
    this.reconcile();
  }

  hostDisconnected(): void {
    this.stop();
  }

  /** Converge the subscription and the tick on the wanted target;
   *  same-target attempts no-op, a null target goes idle. */
  reconcile(): void {
    const api = this._options.api();
    const wantName = api !== undefined ? this._options.deviceName() : null;
    this._syncInterval(wantName !== null);
    const generation = api?.connectionGeneration ?? 0;
    const generationChanged =
      this._subscribedName !== null && generation !== this._subscribedGeneration;
    if (wantName === this._subscribedName && !generationChanged) return;

    this._teardown();
    if (wantName === null || api === undefined) return;

    // Skip a (device, generation) that already failed: permanent errors
    // (NOT_FOUND, INVALID_ARGS) would otherwise re-fire every tick. The
    // key rotates on target change and WS reconnect.
    const attemptKey = `${wantName}:${generation}`;
    if (this._failedKey === attemptKey) return;

    this._subscribedName = wantName;
    this._subscribedGeneration = generation;
    void this._open(api, wantName, generation, attemptKey);
  }

  /** Clear the failure memos; call on an explicit user retry (reopen). */
  retry(): void {
    this._failedKey = null;
    this._loggedKey = null;
  }

  /** Tear down and disarm now, independent of host disconnect. */
  stop(): void {
    this._syncInterval(false);
    this._teardown();
  }

  private async _open(
    api: ESPHomeAPI,
    deviceName: string,
    attemptGeneration: number,
    attemptKey: string
  ): Promise<void> {
    // A WS reconnect (generation bump) or a target change between
    // subscribe-start and resolve makes this attempt stale; catch must
    // not mutate state belonging to the newer attempt, and a stale
    // success must unsubscribe the just-created handle.
    const isCurrent = (): boolean =>
      this._subscribedName === deviceName &&
      this._subscribedGeneration === attemptGeneration;

    try {
      const subscription = await api.subscribeDeviceReachability(
        deviceName,
        (state: ReachabilityStateEvent) => {
          if (isCurrent()) this._options.onEvent(state);
        }
      );
      if (!isCurrent()) {
        void subscription.unsubscribe();
        return;
      }
      this._subscription = subscription;
      this._failedKey = null;
    } catch (err) {
      // Rate-limit the warning: the 1 Hz tick retries reconcile, and a
      // WS-not-yet-connected window would otherwise log every second.
      if (this._loggedKey !== attemptKey) {
        this._loggedKey = attemptKey;
        console.warn("subscribeDeviceReachability failed", err);
      }
      if (isCurrent()) {
        this._failedKey = attemptKey;
        this._subscribedName = null;
      }
    }
  }

  private _teardown(): void {
    const hadTarget = this._subscribedName !== null;
    this._subscribedName = null;
    if (this._subscription !== null) {
      const sub = this._subscription;
      this._subscription = null;
      void sub.unsubscribe();
    }
    if (hadTarget) this._options.onTeardown?.();
  }

  private _syncInterval(want: boolean): void {
    if (want && this._interval === null) {
      this._interval = setInterval(() => {
        if (this._options.tickRender) this._host.requestUpdate();
        this.reconcile();
      }, 1000);
    } else if (!want && this._interval !== null) {
      clearInterval(this._interval);
      this._interval = null;
    }
  }
}
