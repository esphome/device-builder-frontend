/**
 * MCUboot updates over the Zephyr mcumgr serial transport: the Web Serial
 * transport for ``smp-protocol``.
 *
 * Wire format: the SMP frame with a length prefix and a CRC16 appended is
 * base64-encoded and split into lines, the first starting 0x06 0x09 and the
 * rest 0x04 0x14, each ending 0x0a.
 *
 * The CRC is Zephyr's crc16_itu_t with seed 0, which is CRC-16/XMODEM.
 */
import { arrayBufferToBase64 } from "../../util/base64.js";
import { markSerialActivity } from "../../util/serial-reacquire.js";
import { SerialStreamSession } from "../../util/serial-stream-session.js";
import { crc16Xmodem } from "../../util/xmodem.js";
import {
  awaitReply,
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
  const crc = crc16Xmodem(smpFrame);
  const pktLen = smpFrame.length + 2; // SMP frame + 2-byte CRC

  const raw = new Uint8Array(2 + smpFrame.length + 2);
  raw[0] = (pktLen >>> 8) & 0xff;
  raw[1] = pktLen & 0xff;
  raw.set(smpFrame, 2);
  raw[2 + smpFrame.length] = (crc >>> 8) & 0xff;
  raw[2 + smpFrame.length + 1] = crc & 0xff;

  const b64 = arrayBufferToBase64(raw.buffer);
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
  // The base64 of the frame in progress; null between frames.
  private b64: string | null = null;

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

  private processLine(line: number[]): void {
    if (line.length < 2) return;
    const body = String.fromCharCode(...line.slice(2));
    if (line[0] === SMP_PKT_START_1 && line[1] === SMP_PKT_START_2) {
      this.b64 = body;
    } else if (line[0] === SMP_PKT_CONT_1 && line[1] === SMP_PKT_CONT_2) {
      if (this.b64 === null) return;
      this.b64 += body;
    } else {
      return;
    }

    // The first 4 base64 chars hold the 2-byte length of the data and CRC.
    const head = this.b64.length >= 4 ? fromBase64(this.b64.slice(0, 4)) : null;
    if (!head) return;
    const length = (head[0] << 8) | head[1];
    const expected = 4 * Math.ceil((2 + length) / 3);
    if (this.b64.length < expected) return;

    const decoded = fromBase64(this.b64.slice(0, expected));
    this.b64 = null;
    if (!decoded || length < 2 || decoded.length < 2 + length) return;
    const data = decoded.slice(2, length);
    const crc = (decoded[length] << 8) | decoded[length + 1];
    if (crc16Xmodem(data) === crc) this.onFrame(data);
  }
}

class SmpSerialSession extends SerialStreamSession implements SmpTransport {
  // One exchange at a time, so one reply is ever awaited.
  private pending: { seq: number; settle(frame: Uint8Array | Error): void } | null = null;
  private readonly decoder = new SmpSerialDecoder((frame) => {
    // A late reply to a request that timed out is not this one's.
    if (this.pending?.seq === frame[6]) this.pending.settle(frame);
  });

  protected onBytes(bytes: Uint8Array): void {
    this.decoder.push(bytes);
  }

  protected onEnded(err: Error): void {
    this.pending?.settle(err);
  }

  async exchange(frame: Uint8Array): Promise<Uint8Array> {
    if (this.readEnded) throw this.readEnded;
    const response = new Promise<Uint8Array>((resolve, reject) => {
      this.pending = {
        seq: frame[6],
        settle: (result) => {
          this.pending = null;
          if (result instanceof Uint8Array) resolve(result);
          else reject(result);
        },
      };
    });
    // A write that fails after the read loop ended leaves this unawaited.
    response.catch(() => {});
    try {
      await this.writeBytes(encodeSerialFrame(frame));
      // A frame that fails its CRC is dropped, so a garbled reply would
      // otherwise wait forever.
      return await this.race(
        awaitReply(response, SERIAL_EXCHANGE_TIMEOUT_MS, this.signal)
      );
    } finally {
      this.pending = null;
    }
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
  let session: SmpSerialSession | undefined;
  let failure: unknown;
  try {
    session = new SmpSerialSession(port, hooks.signal);
    // Not negotiated like Bluetooth's: larger frames are untested against
    // the device's UART receive buffers.
    await smpUploadImage(session, image, SMP_CHUNK_SIZE_DEFAULT, hooks);
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    // The locks have to be released before the port closes.
    await session?.close(failure).catch(() => {});
    markSerialActivity();
    await port.close().catch(() => {});
  }
}
