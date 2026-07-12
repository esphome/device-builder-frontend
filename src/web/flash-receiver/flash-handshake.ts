import {
  type FirmwareMessage,
  type FlashState,
  isFlashParts,
  MSG_FIRMWARE,
  MSG_PROGRESS,
  MSG_READY,
  MSG_STATE,
  PROTOCOL_VERSION,
} from "./protocol.js";

/** Hash params the receiver reads. ``nonce`` is required to activate. */
export interface FlasherParams {
  nonce: string;
  /** Pins the outbound targetOrigin from frame zero; optional (defence in depth). */
  origin: string | null;
}

/** Parse ``#nonce=…&origin=…``. Returns null when there's no nonce (not a handoff). */
export function parseFlasherParams(hash: string): FlasherParams | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const nonce = params.get("nonce");
  if (!nonce) return null;
  return { nonce, origin: params.get("origin") };
}

export interface FlashHandshakeCallbacks {
  /** A valid firmware frame arrived from the opener. */
  onFirmware: (msg: FirmwareMessage) => void;
  /** The opener attached and sent, but the payload was unusable. */
  onMalformed: () => void;
  /**
   * No firmware arrived before the ``ready`` re-announce window elapsed — the
   * hand-off is dead. Lets the receiver show a terminal "return to the
   * dashboard" state instead of silently waiting forever.
   */
  onTimeout?: () => void;
}

export interface FlashHandshakeEnv {
  /** The opening window (``window.opener``); postMessage target + source id. */
  opener: Window | null;
  params: FlasherParams;
  /** Where to listen for ``message`` events (``window``). Injected for tests. */
  messageTarget: Pick<EventTarget, "addEventListener" | "removeEventListener">;
}

/** How long to keep re-announcing ``ready`` before giving up (ms). */
const READY_RETRY_TOTAL_MS = 10000;
const READY_RETRY_INTERVAL_MS = 500;

/**
 * Drives the receiver side of the postMessage handshake: announce ``ready``
 * (re-sent until firmware arrives, so a late opener listener can't wedge the
 * handoff), authenticate inbound firmware by source + nonce, and relay
 * ``state`` / ``progress`` back to the opener.
 */
export class FlashHandshake {
  private _targetOrigin: string;
  private _handedOff = false;
  private _readyTimer?: ReturnType<typeof setInterval>;
  private _waited = 0;

  constructor(
    private readonly env: FlashHandshakeEnv,
    private readonly cb: FlashHandshakeCallbacks
  ) {
    // Learned from the first inbound frame if not pinned; a malformed
    // ``origin=null`` falls back to '*' rather than wedging postMessage.
    this._targetOrigin =
      env.params.origin && env.params.origin !== "null" ? env.params.origin : "*";
  }

  /** Attach the listener and start announcing ``ready``. */
  start(): void {
    this.env.messageTarget.addEventListener("message", this._onMessage as EventListener);
    this._sendReady();
    this._readyTimer = setInterval(() => {
      if (this._handedOff) {
        this._stopReadyRetry();
        return;
      }
      this._waited += READY_RETRY_INTERVAL_MS;
      if (this._waited >= READY_RETRY_TOTAL_MS) {
        // Gave up waiting for the opener — tell the receiver so it can surface
        // a terminal state rather than silently going quiet.
        this._stopReadyRetry();
        this.cb.onTimeout?.();
        return;
      }
      this._sendReady();
    }, READY_RETRY_INTERVAL_MS);
  }

  stop(): void {
    this._stopReadyRetry();
    this.env.messageTarget.removeEventListener(
      "message",
      this._onMessage as EventListener
    );
  }

  postState(state: FlashState, detail?: string): void {
    this._post({ type: MSG_STATE, state, detail });
  }

  postProgress(pct: number): void {
    this._post({ type: MSG_PROGRESS, pct });
  }

  private _sendReady(): void {
    this._post({ type: MSG_READY, version: PROTOCOL_VERSION });
  }

  private _stopReadyRetry(): void {
    if (this._readyTimer !== undefined) {
      clearInterval(this._readyTimer);
      this._readyTimer = undefined;
    }
  }

  private _post(msg: object): void {
    // Outbound frames carry no nonce, so the pre-handoff '*' fallback leaks
    // nothing. A malformed origin= makes postMessage throw; fall back to '*'.
    try {
      this.env.opener?.postMessage(msg, this._targetOrigin);
    } catch (err) {
      console.error("Flasher postMessage failed; falling back to '*':", err);
      this._targetOrigin = "*";
      try {
        this.env.opener?.postMessage(msg, "*");
      } catch (err2) {
        console.error("Flasher postMessage failed after origin fallback:", err2);
      }
    }
  }

  private _onMessage = (ev: MessageEvent): void => {
    // Only the opener, only a matching nonce. No origin allowlist is possible:
    // the dashboard runs on an arbitrary (often http) origin.
    if (!this.env.opener || ev.source !== this.env.opener) return;
    const data = ev.data as Partial<FirmwareMessage> | undefined;
    if (!data || data.type !== MSG_FIRMWARE) return;
    if (data.nonce !== this.env.params.nonce) return;
    // Ignore a duplicate firmware frame once we've handed off — re-processing
    // would reset the UI to "connecting" and relay a bogus state mid-flash.
    if (this._handedOff) return;
    if (!isFlashParts(data.parts)) {
      // The opener has clearly attached; stop re-announcing even though the
      // payload is unusable.
      this._stopReadyRetry();
      this.cb.onMalformed();
      return;
    }
    // The opener origin is now known; pin outbound to it.
    if (this._targetOrigin === "*" && ev.origin && ev.origin !== "null") {
      this._targetOrigin = ev.origin;
    }
    this._stopReadyRetry();
    this._handedOff = true;
    this.cb.onFirmware(data as FirmwareMessage);
  };
}
