import { FLASHER_ORIGIN, FLASHER_URL } from "../common/docs.js";

// Message types, mirroring flasher/src/protocol.ts in the device-builder repo.
// The nonce travels one way only (dashboard -> flasher).
const MSG_READY = "esphome-web-flash:ready";
const MSG_FIRMWARE = "esphome-web-flash:firmware";
const MSG_STATE = "esphome-web-flash:state";
const MSG_PROGRESS = "esphome-web-flash:progress";

// Give up if the flasher tab never reports "ready" (failed to load / crashed).
const READY_TIMEOUT_MS = 60 * 1000;
// Bound the flash itself (armed at hand-off).
const FLASH_WATCHDOG_MS = 10 * 60 * 1000;

export interface FlasherCallbacks {
  /** Flash write progress, 0-100. */
  onProgress: (pct: number) => void;
  /** A non-terminal status line from the flasher (e.g. "connecting"). */
  onStatus: (detail: string) => void;
  /** Terminal result. */
  onState: (state: "done" | "error", detail: string) => void;
  /** The flasher tab closed / crashed / went silent before a result. */
  onLost: () => void;
}

/**
 * Open the external secure-context flasher and hand off the firmware over
 * postMessage. Pure and dialog-agnostic: results come back through callbacks.
 *
 * Returns a teardown (stop listening + clear timers), or null if the pop-up was
 * blocked. Must be called from a user gesture so the pop-up isn't blocked, and
 * only after a working firmware exists (the caller owns that ordering).
 */
export function openFlasher(
  firmware: ArrayBuffer,
  name: string,
  cb: FlasherCallbacks
): (() => void) | null {
  const nonce = crypto.randomUUID();
  const win = window.open(
    `${FLASHER_URL}#nonce=${encodeURIComponent(nonce)}&origin=${encodeURIComponent(
      location.origin
    )}`,
    "_blank"
  );
  if (!win) return null;

  let bytes: ArrayBuffer | null = firmware;
  const controller = new AbortController();
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let closePoll: ReturnType<typeof setInterval> | undefined;
  let finished = false;
  let handedOff = false;

  // Pure teardown (also the returned handle): no callback, so a caller closing
  // the session doesn't trigger onLost.
  const finish = () => {
    if (finished) return;
    finished = true;
    controller.abort();
    if (readyTimer !== undefined) clearTimeout(readyTimer);
    if (watchdog !== undefined) clearTimeout(watchdog);
    if (closePoll !== undefined) clearInterval(closePoll);
  };
  const lost = () => {
    if (finished) return;
    finish();
    cb.onLost();
  };

  const onMessage = (ev: MessageEvent) => {
    if (ev.origin !== FLASHER_ORIGIN || ev.source !== win) return;
    const data = ev.data as {
      type?: string;
      state?: string;
      detail?: string;
      pct?: number;
    };
    if (!data?.type) return;
    if (data.type === MSG_READY) {
      if (readyTimer !== undefined) clearTimeout(readyTimer);
      if (handedOff || !bytes) return;
      handedOff = true;
      win.postMessage(
        {
          type: MSG_FIRMWARE,
          nonce,
          name,
          erase: true,
          parts: [{ address: 0, data: bytes }],
        },
        FLASHER_ORIGIN,
        [bytes]
      );
      bytes = null; // transferred (detached)
      watchdog = setTimeout(lost, FLASH_WATCHDOG_MS);
    } else if (data.type === MSG_PROGRESS) {
      cb.onProgress(data.pct ?? 0);
    } else if (data.type === MSG_STATE) {
      if (data.state === "done") {
        finish();
        cb.onState("done", "");
      } else if (data.state === "error") {
        finish();
        cb.onState("error", data.detail || "");
      } else if (data.detail) {
        cb.onStatus(data.detail);
      }
    }
  };

  window.addEventListener("message", onMessage, { signal: controller.signal });
  closePoll = setInterval(() => {
    if (win.closed) lost();
  }, 1000);
  readyTimer = setTimeout(lost, READY_TIMEOUT_MS);
  return finish;
}
