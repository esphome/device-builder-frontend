import type { ESPHomeFirmwareInstallDialog } from "../../components/firmware-install-dialog.js";
/**
 * MCUboot OTA via serial SMP — Zephyr mcumgr serial transport and install flow.
 *
 * Wire format (NMP/mcumgr-over-serial):
 *   Send: SMP frame → append CRC16 → base64 → fragment at 127 chars
 *         First line:  0x06 0x09  uint16BE(total_b64_len)  <b64_chunk>  0x0a
 *         Next lines:  0x04 0x14  <b64_chunk>  0x0a
 *   Recv: same framing, reassemble until total_b64_len received
 *
 * CRC16: polynomial 0x1021, init 0x0000 (CRC16/CCITT-FALSE / ITU-T variant used
 * by Zephyr's crc16_itu_t with seed=0).
 */
import {
  downloadBuildArtifact,
  installLog,
  pickSerialPortOrFail,
} from "../../components/firmware-install-dialog/browser-flash-steps.js";
import { getErrorMessage } from "../../util/error-message.js";
import { markSerialActivity } from "../../util/serial-reacquire.js";
import { SerialStreamSession } from "../../util/serial-stream-session.js";
import { type BrowserInstall, FlashImageSlot } from "../platform-support.js";
import {
  type McubootImageInfo,
  parseMcubootImageInfo,
  SMP_CHUNK_SIZE_SERIAL,
  type SmpTransport,
  smpUploadImage,
} from "./smp-protocol.js";

declare module "../platform-support.js" {
  interface BrowserFlasherSteps {
    "nrf-smp-serial": "nrf-smp-serial-ready";
  }
}

const SMP_SERIAL_BAUD = 115200;
// mcumgr serial start / continuation markers and the line delimiter.
const SMP_PKT_START_1 = 0x06;
const SMP_PKT_START_2 = 0x09;
const SMP_PKT_CONT_1 = 0x04;
const SMP_PKT_CONT_2 = 0x14;
const SMP_PKT_DELIM = 0x0a;
// Max base64 chars per line. The full frame (2 marker bytes + base64 + newline)
// must fit the device's line buffer (128 bytes) → 128 − 2 − 1 = 125; use 124.
const SMP_SERIAL_MAX_B64_PER_LINE = 124;

// ── base64 helpers ─────────────────────────────────────────────────────────

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

// ── CRC16 (poly=0x1021, init=0, no reflection) ──────────────────────────────

/** Exported for tests. */
export function crc16CcittItu(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return crc & 0xffff;
}

// ── Framing ──────────────────────────────────────────────────────────────────

/**
 * Encode an SMP frame into one or more mcumgr serial lines.
 *
 * The raw packet is `[uint16_be(len)] [smp_frame] [uint16_be(crc16)]` where
 * `len = smp_frame.length + 2` (the trailing CRC) and the CRC is computed over
 * the SMP frame only. The whole raw packet is base64-encoded, then split into
 * lines: the first prefixed with 0x06 0x09, continuations with 0x04 0x14, each
 * terminated by 0x0a. The length prefix lives *inside* the base64 payload.
 *
 * Exported for tests.
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

// ── Session ──────────────────────────────────────────────────────────────────

class SmpSerialSession extends SerialStreamSession {
  private rxLine: number[] = [];
  private b64Accum = "";
  private pktLen = -1; // decoded packet length (SMP data + CRC), from the prefix
  private expectedB64 = -1; // total base64 chars for the full packet
  private resolve: ((frame: Uint8Array) => void) | null = null;
  private reject: ((err: Error) => void) | null = null;

  constructor(port: SerialPort, signal: AbortSignal | undefined) {
    super(port, signal);
  }

  protected onBytes(bytes: Uint8Array): void {
    for (const b of bytes) {
      if (b !== SMP_PKT_DELIM) {
        this.rxLine.push(b);
        continue;
      }
      this.processLine(this.rxLine);
      this.rxLine = [];
    }
  }

  protected onEnded(err: Error): void {
    this.reject?.(err);
  }

  private resetAccum(): void {
    this.b64Accum = "";
    this.pktLen = -1;
    this.expectedB64 = -1;
  }

  private processLine(line: number[]): void {
    if (line.length < 2) return;

    if (line[0] === SMP_PKT_START_1 && line[1] === SMP_PKT_START_2) {
      // Start of a new packet.
      this.resetAccum();
      this.b64Accum = String.fromCharCode(...line.slice(2));
    } else if (line[0] === SMP_PKT_CONT_1 && line[1] === SMP_PKT_CONT_2) {
      if (this.b64Accum === "" && this.pktLen < 0) return; // stray continuation
      this.b64Accum += String.fromCharCode(...line.slice(2));
    } else {
      return; // Not an SMP serial frame (e.g. a shell log line) — ignore.
    }

    // Once we have the first 4 base64 chars we can decode the 2-byte length
    // prefix and know the total encoded length to expect.
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
    if (crc16CcittItu(data) !== receivedCrc) return; // CRC mismatch

    this.resolve?.(data);
    this.resolve = null;
    this.reject = null;
  }

  waitResponse(signal: AbortSignal | undefined): Promise<Uint8Array> {
    if (this.readEnded) return Promise.reject(this.readEnded);
    const p = new Promise<Uint8Array>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
      signal?.addEventListener("abort", () => rej(signal.reason), { once: true });
    }).finally(() => {
      this.resolve = null;
      this.reject = null;
    });
    return this.race(p);
  }

  async send(bytes: Uint8Array): Promise<void> {
    await this.writeBytes(bytes);
  }
}

/** SMP transport backed by the mcumgr serial protocol over Web Serial. */
class SmpSerialTransport implements SmpTransport {
  constructor(private readonly session: SmpSerialSession) {}

  async send(
    frame: Uint8Array,
    signal?: AbortSignal
  ): Promise<{ response: Promise<Uint8Array> }> {
    const response = this.session.waitResponse(signal);
    await this.session.send(encodeSerialFrame(frame));
    return { response };
  }

  async exchange(frame: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
    const { response } = await this.send(frame, signal);
    return response;
  }

  /**
   * Returns a promise so callers can await the reader/writer locks being
   * released before closing the port — otherwise port.close() races the
   * teardown, fails on the still-locked streams, and leaves the port open.
   */
  close(): Promise<void> {
    return this.session.close(undefined);
  }
}

// ── Install flow ──────────────────────────────────────────────────────────────

interface McubootSerialSlotData {
  image: Uint8Array;
  info: McubootImageInfo;
}

export const nrfSmpSerialImage = new FlashImageSlot<McubootSerialSlotData>();

async function startNrfSmpSerialInstall(
  host: ESPHomeFirmwareInstallDialog
): Promise<void> {
  const device = host._device;
  if (!device) return;

  const artifact = await downloadBuildArtifact(
    host,
    device,
    (binaries) => binaries.find((b) => b.file.endsWith("app_update.bin")),
    "firmware.nrf_no_mcuboot_bin"
  );
  if (!artifact) return;

  let info: McubootImageInfo;
  try {
    info = await parseMcubootImageInfo(artifact.bytes);
  } catch (err) {
    if (host._device === device)
      host._fail(host._localize("firmware.nrf_bad_mcuboot_image"), getErrorMessage(err));
    return;
  }

  if (host._device !== device) return;
  nrfSmpSerialImage.set(host, { image: artifact.bytes, info });
  host._step = "nrf-smp-serial-ready";
  host._statusMessage = host._localize("firmware.nrf_smp_serial_ready_title");
}

async function nrfDoSmpSerialFlash(host: ESPHomeFirmwareInstallDialog): Promise<void> {
  const slot = nrfSmpSerialImage.get(host);
  if (!slot || host._flashBusy) return;

  const device = host._device;
  const stillCurrent = () =>
    host._device === device && nrfSmpSerialImage.get(host) === slot;

  const port = await pickSerialPortOrFail(host, stillCurrent);
  if (!port || !stillCurrent()) return;

  host._step = "flashing";
  host._statusMessage = host._localize("firmware.status_flashing");
  host._flashPercent = 0;

  const abort = new AbortController();
  host._flashAbort = abort;
  let transport: SmpSerialTransport | undefined;

  const log = installLog(host, stillCurrent);
  try {
    // A prior attempt may have left the port open (e.g. a teardown that raced
    // port.close()). Close it first so open() doesn't throw "already open".
    if (port.readable || port.writable) {
      try {
        await port.close();
      } catch {
        /* ignore */
      }
    }
    log(`Opening serial port at ${SMP_SERIAL_BAUD} baud`);
    await port.open({ baudRate: SMP_SERIAL_BAUD });
    const session = new SmpSerialSession(port, abort.signal);
    transport = new SmpSerialTransport(session);

    await smpUploadImage(transport, slot.image, slot.info, SMP_CHUNK_SIZE_SERIAL, {
      signal: abort.signal,
      onProgress: (pct) => {
        if (stillCurrent()) host._flashPercent = pct;
      },
      onLog: log,
    });
  } catch (err) {
    if (stillCurrent()) {
      host._fail(host._localize("firmware.nrf_smp_serial_failed"), getErrorMessage(err));
    }
    return;
  } finally {
    // Await the session teardown (reader/writer lock release) BEFORE closing the
    // port, or port.close() races the still-locked streams and leaves it open.
    try {
      await transport?.close();
    } catch {
      /* ignore */
    }
    markSerialActivity();
    try {
      await port.close();
    } catch {
      /* ignore */
    }
    if (host._flashAbort === abort) host._flashAbort = null;
  }

  if (!stillCurrent()) return;
  host._statusMessage = host._localize("firmware.status_done");
  host._step = "done";
}

export const nrfSmpSerialInstall: BrowserInstall<"nrf-smp-serial"> = {
  id: "nrf-smp-serial",
  methodKey: "nrf_smp_serial",
  holdsPort: false,
  advanced: true,
  image: nrfSmpSerialImage,
  start: startNrfSmpSerialInstall,
  showFirstStep(host) {
    host._step = "nrf-smp-serial-ready";
    host._statusMessage = host._localize("firmware.nrf_smp_serial_ready_title");
  },
  steps: {
    "nrf-smp-serial-ready": {
      detailKey: "firmware.nrf_smp_serial_ready_desc",
      footer: () => ({
        primary: { run: nrfDoSmpSerialFlash, labelKey: "firmware.browser_flash_action" },
      }),
    },
  },
};
