import { DECODER_ORIGIN, DECODER_URL } from "../common/docs.js";
import { randomNonce } from "./random-nonce.js";

// Message types, mirroring esp-stacktrace-decoder/src/protocol.ts in the
// device-builder repo. The nonce travels one way only (dashboard -> decoder).
const MSG_READY = "esphome-stacktrace-decode:ready";
const MSG_REQUEST = "esphome-stacktrace-decode:request";
const MSG_RESULT = "esphome-stacktrace-decode:result";
const MSG_ERROR = "esphome-stacktrace-decode:error";
// The page announcing, before any request, that it will never answer.
const MSG_UNAVAILABLE = "esphome-stacktrace-decode:unavailable";

// The wire protocol version this dashboard speaks. Bumped only for a breaking
// change; additive fields/messages don't need it. Sent in the request frame and
// read from "ready" so a future version gate has both sides to branch on.
const PROTOCOL_VERSION = 1;

// Give up if the decoder never reports ready. This is the offline / GitHub-down
// path, so it must be short: it is spent before the raw dump is shown, and the
// answer when it expires is simply "no decode".
const READY_TIMEOUT_MS = 10 * 1000;
// Bound one decode. Parsing an 18MB ELF's DWARF is seconds, not minutes; this
// only catches a wedged page.
const DECODE_TIMEOUT_MS = 60 * 1000;

/** One resolved frame, as the decoder reports it. */
export interface DecodedFrame {
  address: number;
  function_name: string;
  location: string;
}

/**
 * The hosted decoder, framed once and reused.
 *
 * Optional by construction: every failure resolves to null rather than
 * throwing, because a decode is an embellishment on a crash report and the raw
 * dump has to stay readable when the decoder is unreachable. A dead decoder is
 * remembered, so a crash loop doesn't re-frame it per region.
 */
class HostedDecoder {
  private _frame: HTMLIFrameElement | null = null;
  private _nonce = "";
  private _ready: Promise<boolean> | null = null;
  private _seq = 0;

  /**
   * Whether the decoder is reachable, framing it on first call.
   *
   * Separate from `decode` so the caller can skip fetching a multi-megabyte ELF
   * when the answer is going to be "no decode" anyway.
   */
  available(): Promise<boolean> {
    if (this._ready === null) this._ready = this._frameDecoder();
    return this._ready;
  }

  /** Decode *dump* against *elf*; null when the decoder can't answer. */
  async decode(elf: ArrayBuffer, dump: string): Promise<DecodedFrame[] | null> {
    if (!(await this.available())) return null;
    const target = this._frame?.contentWindow;
    if (!target) return null;
    const id = `d${++this._seq}`;
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = (frames: DecodedFrame[] | null) => {
        window.removeEventListener("message", onMessage);
        if (timer !== undefined) clearTimeout(timer);
        resolve(frames);
      };
      const onMessage = (ev: MessageEvent) => {
        if (ev.origin !== DECODER_ORIGIN || ev.source !== target) return;
        const data = ev.data as { type?: string; id?: string; frames?: DecodedFrame[] };
        if (data?.id !== id) return;
        if (data.type === MSG_RESULT) done(data.frames ?? []);
        else if (data.type === MSG_ERROR) done(null);
      };
      window.addEventListener("message", onMessage);
      timer = setTimeout(() => done(null), DECODE_TIMEOUT_MS);
      try {
        // Cloned, not transferred. The decoder is a foreign origin, so the
        // bytes cross a process boundary and get copied either way; transferring
        // would only detach the caller's cached ELF, forcing it to copy first.
        target.postMessage(
          {
            type: MSG_REQUEST,
            version: PROTOCOL_VERSION,
            nonce: this._nonce,
            id,
            elf,
            dump,
          },
          DECODER_ORIGIN
        );
      } catch (err) {
        // postMessage can throw (a detached buffer, DataCloneError). Converge to
        // "no decode" rather than leaving the caller waiting on the timeout.
        console.warn("Stack trace decode hand-off failed", err);
        done(null);
      }
    });
  }

  private _frameDecoder(): Promise<boolean> {
    return new Promise((resolve) => {
      const nonce = randomNonce();
      const frame = document.createElement("iframe");
      frame.hidden = true;
      frame.setAttribute("aria-hidden", "true");
      // Scripts, so the wasm runs; same-origin, so the page keeps its own
      // origin and its `connect-src 'self'` still resolves the wasm. Nothing
      // else: no top-level navigation, popups, forms, or downloads. Keeping its
      // origin can't un-sandbox it here, because it is cross-origin from us.
      frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
      // A tab would need a user gesture and would interrupt the log the user is
      // reading; the decode needs neither a gesture nor a secure context.
      frame.src = `${DECODER_URL}#nonce=${encodeURIComponent(nonce)}&origin=${encodeURIComponent(
        location.origin
      )}`;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle = (ok: boolean) => {
        window.removeEventListener("message", onReady);
        if (timer !== undefined) clearTimeout(timer);
        if (!ok) frame.remove();
        resolve(ok);
      };
      const onReady = (ev: MessageEvent) => {
        if (ev.origin !== DECODER_ORIGIN || ev.source !== frame.contentWindow) return;
        const data = ev.data as { type?: string; version?: number; reason?: string };
        if (data?.type === MSG_UNAVAILABLE) {
          // It loaded and told us it won't answer, so there is nothing to wait
          // for. Logged because this is a wiring mistake on our side, not an
          // outage, and the page's own console is inside a hidden frame.
          console.warn(
            "Stack trace decoder is unavailable:",
            data.reason ?? "no reason given"
          );
          settle(false);
          return;
        }
        if (data?.type !== MSG_READY) return;
        // Forward-compat: a decoder advertising a newer protocol still gets our
        // v1 frame (additive fields are ignored); just note the mismatch. When a
        // breaking change lands, branch on data.version here.
        if (typeof data.version === "number" && data.version > PROTOCOL_VERSION) {
          console.warn(
            `Stack trace decoder protocol v${data.version} is newer than this dashboard's v${PROTOCOL_VERSION}; proceeding with v${PROTOCOL_VERSION}.`
          );
        }
        this._frame = frame;
        this._nonce = nonce;
        settle(true);
      };
      window.addEventListener("message", onReady);
      // The page is unreachable when offline or when Pages is down, and an
      // iframe that never loads fires no error we can rely on, so time out.
      timer = setTimeout(() => settle(false), READY_TIMEOUT_MS);
      document.body.appendChild(frame);
    });
  }
}

// One per session: framing costs a page load and a ~1MB wasm compile, and a
// device that crashes once tends to crash again.
let decoder: HostedDecoder | null = null;

/** The session's decoder, created on first use. */
export function hostedDecoder(): HostedDecoder {
  if (decoder === null) decoder = new HostedDecoder();
  return decoder;
}

/** Drop the session's decoder. Tests only; production keeps one for the tab. */
export function resetHostedDecoder(): void {
  decoder = null;
}
