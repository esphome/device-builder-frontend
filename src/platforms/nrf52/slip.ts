/**
 * SLIP framing (RFC 1055) as Nordic's bootloaders speak it over serial, and
 * the session that splits a port's bytes into frames for the two DFU
 * engines: legacy DFU wraps HCI packets in it, Secure DFU its requests.
 */
import { SerialStreamSession } from "../../util/serial-stream-session.js";

export const SLIP_END = 0xc0;
export const SLIP_ESC = 0xdb;
export const SLIP_ESC_END = 0xdc;
export const SLIP_ESC_ESC = 0xdd;

export function slipEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (const b of data) {
    if (b === SLIP_END) {
      out.push(SLIP_ESC, SLIP_ESC_END);
    } else if (b === SLIP_ESC) {
      out.push(SLIP_ESC, SLIP_ESC_ESC);
    } else {
      out.push(b);
    }
  }
  return new Uint8Array(out);
}

export function slipDecode(data: Uint8Array): Uint8Array {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === SLIP_ESC) {
      i++;
      if (i >= data.length) throw new Error("Truncated SLIP escape sequence");
      result.push(data[i] === SLIP_ESC_END ? SLIP_END : SLIP_ESC);
    } else {
      result.push(data[i]);
    }
  }
  return new Uint8Array(result);
}

/**
 * A serial session whose device answers in SLIP frames: each ``END``
 * closes one, an empty frame (a leading ``END``, or two in a row) is
 * nothing, and a frame that does not decode is dropped so the engine keeps
 * waiting for the real answer.
 */
export abstract class SlipFrameSession extends SerialStreamSession {
  private rxBuf: number[] = [];

  protected onBytes(bytes: Uint8Array): void {
    for (const b of bytes) {
      if (b !== SLIP_END) {
        this.rxBuf.push(b);
        continue;
      }
      const raw = this.rxBuf;
      this.rxBuf = [];
      if (raw.length === 0) continue;
      let frame: Uint8Array;
      try {
        frame = slipDecode(new Uint8Array(raw));
      } catch {
        continue; // Malformed frame; keep waiting.
      }
      if (frame.length > 0) this.onFrame(frame);
    }
  }

  /** One decoded frame, as the device sent it; runs on the read loop. */
  protected abstract onFrame(frame: Uint8Array): void;
}
