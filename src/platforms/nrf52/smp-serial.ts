/**
 * MCUboot updates over the Zephyr mcumgr serial transport: the Web Serial
 * transport for ``smp-protocol``.
 *
 * Wire format: the SMP frame with a length prefix and a CRC16 appended is
 * base64-encoded and split into lines, the first starting 0x06 0x09 and the
 * rest 0x04 0x14, each ending 0x0a.
 *
 * CRC16: polynomial 0x1021, init 0 (Zephyr's crc16_itu_t with seed 0).
 */
import { markSerialActivity } from "../../util/serial-reacquire.js";
import { SerialStreamSession } from "../../util/serial-stream-session.js";
import { withDeadline } from "../../util/with-deadline.js";
import {
  type McubootImage,
  SMP_CHUNK_SIZE_DEFAULT,
  type SmpTransport,
  type SmpUploadHooks,
  smpUploadImage,
} from "./smp-protocol.js";

const SMP_SERIAL_BAUD = 115200;
const SERIAL_EXCHANGE_TIMEOUT_MS = 10_000;
const SMP_PKT_START_1 = 0x06;
const SMP_PKT_START_2 = 0x09;
const SMP_PKT_CONT_1 = 0x04;
const SMP_PKT_CONT_2 = 0x14;
const SMP_PKT_DELIM = 0x0a;
// A line (2 marker bytes, base64, newline) must fit the device's 128-byte
// line buffer.
const SMP_SERIAL_MAX_B64_PER_LINE = 124;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function crc16CcittItu(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return crc & 0xffff;
}

/**
 * Encode an SMP frame into one or more mcumgr serial lines.
 *
 * The raw packet is `[uint16_be(len)] [smp_frame] [uint16_be(crc16)]` where
 * `len = smp_frame.length + 2` (the trailing CRC) and the CRC is computed over
 * the SMP frame only. The whole raw packet is base64-encoded, then split into
 * lines: the first prefixed with 0x06 0x09, continuations with 0x04 0x14, each
 * terminated by 0x0a. The length prefix lives *inside* the base64 payload.
 */
export function encodeSerialFrame(smpFrame: Uint8Array): Uint8Array {
  const crc = crc16CcittItu(smpFrame);
  const pktLen = smpFrame.length + 2; // SMP frame + 2-byte CRC

  const raw = new Uint8Array(2 + smpFrame.length + 2);
  raw[0] = (pktLen >>> 8) & 0xff;
  raw[1] = pktLen & 0xff;
  raw.set(smpFrame, 2);
  raw[2 + smpFrame.length] = (crc >>> 8) & 0xff;
  raw[2 + smpFrame.length + 1] = crc & 0xff;

  const b64 = toBase64(raw);
  const lines: number[] = [];

  for (let start = 0; start < b64.length; start += SMP_SERIAL_MAX_B64_PER_LINE) {
    const chunk = b64.slice(start, start + SMP_SERIAL_MAX_B64_PER_LINE);
    lines.push(
      start === 0 ? SMP_PKT_START_1 : SMP_PKT_CONT_1,
      start === 0 ? SMP_PKT_START_2 : SMP_PKT_CONT_2
    );
    for (let i = 0; i < chunk.length; i++) lines.push(chunk.charCodeAt(i));
    lines.push(SMP_PKT_DELIM);
  }

  return new Uint8Array(lines);
}

/**
 * Reassembles SMP frames from mcumgr serial lines. Lines that are not part
 * of a frame (a shell's log output) and frames that fail their CRC are
 * dropped.
 */
export class SmpSerialDecoder {
  private rxLine: number[] = [];
  private b64Accum = "";
  // Decoded packet length (SMP data + CRC), from the prefix.
  private pktLen = -1;
  private expectedB64 = -1;

  constructor(private readonly onFrame: (frame: Uint8Array) => void) {}

  push(bytes: Uint8Array): void {
    for (const b of bytes) {
      if (b !== SMP_PKT_DELIM) {
        this.rxLine.push(b);
        continue;
      }
      this.processLine(this.rxLine);
      this.rxLine = [];
    }
  }

  private resetAccum(): void {
    this.b64Accum = "";
    this.pktLen = -1;
    this.expectedB64 = -1;
  }

  private processLine(line: number[]): void {
    if (line.length < 2) return;

    if (line[0] === SMP_PKT_START_1 && line[1] === SMP_PKT_START_2) {
      this.resetAccum();
      this.b64Accum = String.fromCharCode(...line.slice(2));
    } else if (line[0] === SMP_PKT_CONT_1 && line[1] === SMP_PKT_CONT_2) {
      if (this.b64Accum === "" && this.pktLen < 0) return; // stray continuation
      this.b64Accum += String.fromCharCode(...line.slice(2));
    } else {
      return;
    }

    // The first 4 base64 chars hold the 2-byte length prefix.
    if (this.pktLen < 0 && this.b64Accum.length >= 4) {
      const head = fromBase64(this.b64Accum.slice(0, 4));
      if (!head || head.length < 2) return;
      this.pktLen = (head[0] << 8) | head[1];
      const totalDecoded = 2 + this.pktLen; // length prefix + (data + CRC)
      this.expectedB64 = 4 * Math.ceil(totalDecoded / 3);
    }

    if (this.expectedB64 < 0 || this.b64Accum.length < this.expectedB64) return;

    const decoded = fromBase64(this.b64Accum.slice(0, this.expectedB64));
    const declaredLen = this.pktLen;
    this.resetAccum();
    if (!decoded || decoded.length < 2 + declaredLen) return;

    // decoded = [len16] [smp data] [crc16]; CRC covers the SMP data only.
    const body = decoded.slice(2, 2 + declaredLen); // data + CRC
    if (body.length < 2) return;
    const data = body.slice(0, body.length - 2);
    const receivedCrc = (body[body.length - 2] << 8) | body[body.length - 1];
    if (crc16CcittItu(data) !== receivedCrc) return;

    this.onFrame(data);
  }
}

class SmpSerialSession extends SerialStreamSession implements SmpTransport {
  private readonly decoder = new SmpSerialDecoder((frame) => this.resolve?.(frame));
  private resolve: ((frame: Uint8Array) => void) | null = null;
  private reject: ((err: Error) => void) | null = null;

  protected onBytes(bytes: Uint8Array): void {
    this.decoder.push(bytes);
  }

  protected onEnded(err: Error): void {
    this.reject?.(err);
  }

  async exchange(frame: Uint8Array): Promise<Uint8Array> {
    if (this.readEnded) throw this.readEnded;
    const response = new Promise<Uint8Array>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    }).finally(() => {
      this.resolve = null;
      this.reject = null;
    });
    await this.writeBytes(encodeSerialFrame(frame));
    // A frame that fails its CRC is dropped, so a garbled reply would
    // otherwise wait forever.
    return this.race(
      withDeadline(
        response,
        SERIAL_EXCHANGE_TIMEOUT_MS,
        () => new Error("SMP: no response from the device")
      )
    );
  }
}

/** Open *port*, upload *image* and boot it; the port is closed either way. */
export async function flashMcubootOverSerial(
  port: SerialPort,
  image: McubootImage,
  hooks: SmpUploadHooks
): Promise<void> {
  // A teardown that lost its race with port.close() leaves the port open.
  if (port.readable || port.writable) await port.close().catch(() => {});
  hooks.onLog?.(`Opening serial port at ${SMP_SERIAL_BAUD} baud`);
  await port.open({ baudRate: SMP_SERIAL_BAUD });
  const session = new SmpSerialSession(port, hooks.signal);
  try {
    await smpUploadImage(session, image, SMP_CHUNK_SIZE_DEFAULT, hooks);
  } finally {
    // The locks have to be released before the port closes.
    await session.close(undefined).catch(() => {});
    markSerialActivity();
    await port.close().catch(() => {});
  }
}
