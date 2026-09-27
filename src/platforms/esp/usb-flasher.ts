import { FLASHER_ORIGIN, FLASHER_URL } from "../../common/docs.js";
import { randomNonce } from "../../util/random-nonce.js";
import {
  DEFAULT_HANDOFF_FLASHER,
  type FirmwareMessage,
  type HandoffSpec,
  MSG_FIRMWARE,
  MSG_PROGRESS,
  MSG_READY,
  MSG_STATE,
  type ProgressMessage,
  PROTOCOL_VERSION,
  type ReadyMessage,
  type StateMessage,
} from "../handoff.js";

/** Any frame the flasher tab sends; untrusted, so every field is optional. */
type InboundFrame = Partial<
  Omit<ReadyMessage, "type"> & Omit<StateMessage, "type"> & Omit<ProgressMessage, "type">
> & { type?: string };

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
  /**
   * The flasher tab loaded but can't take this hand-off, advertised on its
   * ready frame: its browser has no Web Serial (e.g. Safari), or it is an
   * older web.esphome.io without the flasher this firmware needs. The
   * firmware was never handed off; the dialog owns the messaging.
   */
  onUnsupported: (reason: "web-serial" | "flasher") => void;
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
  deviceName: string,
  { flasher, erase }: Pick<HandoffSpec, "flasher" | "erase">,
  cb: FlasherCallbacks
): (() => void) | null {
  const nonce = randomNonce();
  const win = window.open(
    `${FLASHER_URL}#nonce=${encodeURIComponent(nonce)}&origin=${encodeURIComponent(
      location.origin
    )}`,
    "_blank"
  );
  if (!win) return null;

  let bytes: ArrayBuffer | null = firmware;
  const controller = new AbortController();
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  let finished = false;
  let handedOff = false;
  // True while the user is sitting on a delivered error (the tab stays open for
  // an in-tab retry). Closing the tab then is "I give up", not "lost contact",
  // so the close poll finishes quietly instead of overwriting the real error.
  // Cleared once the flasher resumes activity, so an interrupted active retry
  // still reports lost.
  let errored = false;

  // Pure teardown (also the returned handle): no callback, so a caller closing
  // the session doesn't trigger onLost.
  const finish = () => {
    if (finished) return;
    finished = true;
    controller.abort();
    clearTimeout(readyTimer);
    if (watchdog !== undefined) clearTimeout(watchdog);
    clearInterval(closePoll);
  };
  const lost = () => {
    if (finished) return;
    finish();
    cb.onLost();
  };

  const onMessage = (ev: MessageEvent) => {
    if (ev.origin !== FLASHER_ORIGIN || ev.source !== win) return;
    const data = ev.data as InboundFrame | undefined;
    if (!data?.type) return;
    if (data.type === MSG_READY) {
      clearTimeout(readyTimer);
      if (handedOff || !bytes) return;
      // The receiver can feature-detect Web Serial (it runs on a secure
      // origin, unlike this dashboard over plain http), and advertises the
      // result on the ready frame. Decline the hand-off instead of
      // transferring firmware to a tab that can never flash. Only an
      // explicit false counts: an older receiver omits the field, and there
      // the hand-off proceeds and the receiver reports the error itself.
      if (data.webSerial === false) {
        finish();
        cb.onUnsupported("web-serial");
        return;
      }
      // Likewise for the flasher: an older receiver omits the list, which
      // means esptool only, so anything else is declined rather than handed
      // to a page that would fail it as a bad ESP image.
      // Anything but a list (absent, or a malformed frame) is esptool only.
      const flashers: unknown[] = Array.isArray(data.flashers)
        ? data.flashers
        : [DEFAULT_HANDOFF_FLASHER];
      if (!flashers.includes(flasher)) {
        finish();
        cb.onUnsupported("flasher");
        return;
      }
      // Forward-compat: a flasher advertising a newer protocol still gets our
      // v1 frame (additive fields are ignored); just note the mismatch. When a
      // breaking change lands, branch on data.version here.
      if (typeof data.version === "number" && data.version > PROTOCOL_VERSION) {
        console.warn(
          `Flasher protocol v${data.version} is newer than this dashboard's v${PROTOCOL_VERSION}; proceeding with v${PROTOCOL_VERSION}.`
        );
      }
      handedOff = true;
      try {
        const frame: FirmwareMessage = {
          type: MSG_FIRMWARE,
          version: PROTOCOL_VERSION,
          nonce,
          name,
          deviceName,
          erase,
          flasher,
          parts: [{ address: 0, data: bytes }],
        };
        win.postMessage(frame, FLASHER_ORIGIN, [bytes]);
      } catch (err) {
        // postMessage can throw (e.g. DataCloneError); converge to a terminal
        // state rather than leaving the dialog stuck flashing with timers armed.
        console.error("Firmware hand-off failed:", err);
        lost();
        return;
      }
      bytes = null; // transferred (detached)
      watchdog = setTimeout(lost, FLASH_WATCHDOG_MS);
      return;
    }
    // Ignore data frames until we've handed off: a stray/early "done" must not
    // flip the dashboard to success before any firmware was sent.
    if (!handedOff) return;
    // Any frame proves the flasher is alive right now, so clear the pending
    // watchdog; re-arm it below only while the flash is still progressing.
    if (watchdog !== undefined) {
      clearTimeout(watchdog);
      watchdog = undefined;
    }
    const armWatchdog = () => {
      watchdog = setTimeout(lost, FLASH_WATCHDOG_MS);
    };
    if (data.type === MSG_PROGRESS) {
      armWatchdog();
      errored = false;
      cb.onProgress(data.pct ?? 0);
    } else if (data.type === MSG_STATE) {
      // What the user has to do by hand, if anything (see StateMessage).
      const note = typeof data.note === "string" ? data.note : "";
      if (data.state === "done") {
        finish();
        // The receiver's own done line is for its tab, not the dashboard.
        cb.onState("done", note);
      } else if (data.state === "error") {
        errored = true;
        // Not terminal: the flasher tab stays open and the user can retry in
        // place (hold BOOT + Connect & install). Keep listening so a later
        // success still reaches the dashboard, but leave the watchdog disarmed:
        // idle-on-error would otherwise fire lost() and overwrite the real error
        // with a misleading "lost contact" (the tab is alive) while severing the
        // retry. Closing the tab now is handled by the errored guard on the
        // close poll; an in-tab retry's progress re-arms above and clears it.
        cb.onState("error", data.detail || "");
      } else if (note || data.detail) {
        armWatchdog();
        errored = false;
        cb.onStatus(note || data.detail || "");
      }
    }
  };

  window.addEventListener("message", onMessage, { signal: controller.signal });
  const closePoll = setInterval(() => {
    if (!win.closed) return;
    // The dialog already shows the real error; a quiet finish keeps it instead
    // of overwriting with "lost contact".
    if (errored) finish();
    else lost();
  }, 1000);
  const readyTimer = setTimeout(lost, READY_TIMEOUT_MS);
  return finish;
}
