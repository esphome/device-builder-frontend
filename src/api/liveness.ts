/**
 * Client-side WS liveness: heartbeat probe + network/visibility events.
 *
 * Owns the timers and listeners; policy (what "dead" and "online" mean
 * for reconnecting) stays with the API client via the hooks.
 */
import { APIError } from "./api-error.js";

// Liveness probe: after HEARTBEAT_INTERVAL_MS of receive silence send
// a 'ping'; no reply within HEARTBEAT_TIMEOUT_MS force-closes the
// socket. Protocol-level server pings are invisible to page JS, so a
// dead link otherwise stays OPEN forever. The tick runs faster than
// the silence threshold so detection lags the threshold by at most
// one tick; the in-flight guard keeps pings non-overlapping. The
// timeout is generous because a backend busy compiling can take over
// 10s to answer (the HA frontend uses 15s for the same reason).
const HEARTBEAT_INTERVAL_MS = 15000;
const HEARTBEAT_TIMEOUT_MS = 15000;
const HEARTBEAT_TICK_MS = 5000;

export interface LivenessMonitorHooks {
  /** Current socket, or null while disconnected. */
  getSocket(): WebSocket | null;
  /** Send the liveness probe; any reply (even an error) resolves it. */
  ping(timeoutMs: number): Promise<unknown>;
  /** The socket is dead: close it and run the disconnect path. */
  onDead(ws: WebSocket): void;
  /** The OS reports connectivity returned; reconnect if warranted. */
  onOnline(): void;
}

export class LivenessMonitor {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _inFlight = false;
  private _lastMessageAt = 0;

  constructor(private readonly _hooks: LivenessMonitorHooks) {}

  // Stable handler references make the add/remove pairs idempotent, so
  // no registration flag is needed across reconnects. The existence
  // guards keep teardown order-independent under test.
  registerNetworkListeners(): void {
    if (typeof window !== "undefined") {
      window.addEventListener("offline", this._onWindowOffline);
      window.addEventListener("online", this._onWindowOnline);
    }
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this._onVisibilityChange);
    }
  }

  unregisterNetworkListeners(): void {
    if (typeof window !== "undefined") {
      window.removeEventListener("offline", this._onWindowOffline);
      window.removeEventListener("online", this._onWindowOnline);
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this._onVisibilityChange);
    }
  }

  /** Stamp receive-side liveness; any frame counts, parseable or not. */
  noteMessage(): void {
    this._lastMessageAt = Date.now();
  }

  startHeartbeat(): void {
    this.stopHeartbeat();
    this._lastMessageAt = Date.now();
    this._timer = setInterval(() => {
      this._tick();
    }, HEARTBEAT_TICK_MS);
  }

  stopHeartbeat(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private readonly _onWindowOffline = (): void => {
    // An idle socket doesn't error when the interface drops; surface
    // the disconnect now instead of after the heartbeat window.
    const ws = this._hooks.getSocket();
    if (ws) this._hooks.onDead(ws);
  };

  private readonly _onWindowOnline = (): void => {
    this._hooks.onOnline();
  };

  private readonly _onVisibilityChange = (): void => {
    // The tick skips while hidden; catch up the moment the tab returns.
    if (document.visibilityState === "visible") this._tick();
  };

  private _tick(): void {
    // A hidden tab has no one to show the disconnect to; the
    // visibilitychange listener ticks immediately on return.
    if (globalThis.document?.visibilityState === "hidden") return;
    if (this._inFlight) return;
    if (Date.now() - this._lastMessageAt < HEARTBEAT_INTERVAL_MS) return;
    const ws = this._hooks.getSocket();
    // Probe only an OPEN socket: a visibility-edge tick during an
    // in-flight connect would otherwise force-close the new attempt.
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    this._inFlight = true;
    this._hooks
      .ping(HEARTBEAT_TIMEOUT_MS)
      .catch((err: unknown) => {
        // An APIError reply proves the link is alive (e.g. the pre-auth
        // gate); only silence or a failed send means a dead socket.
        if (err instanceof APIError) return;
        console.debug("[WS] Heartbeat got no reply; closing socket", err);
        if (this._hooks.getSocket() === ws) this._hooks.onDead(ws);
      })
      .catch((err: unknown) => {
        // A throw from the disconnect fan-out must not become an
        // unhandled rejection, but it must not vanish either.
        console.error("[WS] Heartbeat close path threw", err);
      })
      .finally(() => {
        this._inFlight = false;
      });
  }
}
