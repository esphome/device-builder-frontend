/**
 * Nordic Secure DFU over the bootloader's USB CDC, as the nRF5 SDK's
 * bootloader speaks it: the factory Open DFU bootloader of the nRF52840
 * Dongle (PCA10059), ESPHome's ``bootloader: nrf``. The package is the same
 * zip ``nrf-dfu.ts`` parses (``nrfutil pkg generate`` writes both); the init
 * packet is a protobuf the bootloader validates, and the transfer goes in
 * objects it checks with CRC-32. After pc-nrfutil's ``dfu_transport_serial``.
 *
 * Every request is one SLIP frame, ``<opcode> <args>``, ended by ``0xC0``
 * (no leading ``END``: the bootloader would answer the empty frame). The
 * reply is ``0x60 <opcode> <result> <payload>``. Writes are the exception:
 * with packet receipt notifications off they get no reply, and the CRC
 * request after them checks what arrived.
 */
import { concat, int32LE } from "../../util/bytes.js";
import { crc32 } from "../../util/crc32.js";
import { tenthLogger } from "../../util/flash-log.js";
import { markSerialActivity } from "../../util/serial-reacquire.js";
import { DfuResponseError } from "./dfu-response-error.js";
import type { DfuFlashHooks, DfuPackage } from "./nrf-dfu.js";
import { SLIP_END, slipEncode, SlipFrameSession } from "./slip.js";

export const OP_CREATE = 0x01;
export const OP_SET_PRN = 0x02;
export const OP_CALC_CRC = 0x03;
export const OP_EXECUTE = 0x04;
export const OP_SELECT = 0x06;
export const OP_GET_MTU = 0x07;
export const OP_WRITE = 0x08;
export const OP_PING = 0x09;
export const OP_RESPONSE = 0x60;

export const OBJECT_COMMAND = 0x01;
export const OBJECT_DATA = 0x02;

export const RESULT_SUCCESS = 0x01;
const RESULT_EXTENDED_ERROR = 0x0b;

const OP_NAMES: Record<number, string> = {
  [OP_CREATE]: "Create object",
  [OP_SET_PRN]: "Set receipt notification",
  [OP_CALC_CRC]: "Calculate CRC",
  [OP_EXECUTE]: "Execute object",
  [OP_SELECT]: "Select object",
  [OP_GET_MTU]: "Get MTU",
  [OP_WRITE]: "Write object",
  [OP_PING]: "Ping",
};

// nrf_dfu_result_t, as pc-nrfutil names them.
const RESULT_NAMES: Record<number, string> = {
  0x00: "invalid opcode",
  0x02: "opcode not supported",
  0x03: "invalid parameter",
  0x04: "insufficient resources",
  0x05: "invalid object",
  0x06: "invalid signature",
  0x07: "unsupported object type",
  0x08: "operation not permitted",
  0x0a: "operation failed",
};

// nrf_dfu_ext_error_code_t, in code order; the SDK's own wording, shortened.
const EXTENDED_ERRORS = [
  "no extended error code was set",
  "invalid error code",
  "the command format was incorrect",
  "the command is not supported or unknown",
  "the init packet is invalid or missing a required field",
  "the firmware version is lower than the one on the device (no downgrade)",
  "the hardware version does not match the one the firmware is built for",
  "the SoftDevice on the device is not one the firmware supports",
  "the init packet has no signature, and this bootloader requires one",
  "the hash type is not supported by the bootloader",
  "the firmware hash cannot be calculated",
  "the signature type is not supported by the bootloader",
  "the firmware hash does not match the one in the init packet",
  "there is not enough space on the device for the firmware",
  "the firmware is already on the device",
];

const RESPONSE_TIMEOUT_MS = 5000;
const PING_TIMEOUT_MS = 1000;
const PING_ATTEMPTS = 3;

// ── Codecs ───────────────────────────────────────────────────────────────────

const bytes = (...values: number[]) => new Uint8Array(values);

/** ``payload`` as the frame the bootloader reads: SLIP-escaped, one trailing END. */
export function frameRequest(payload: Uint8Array): Uint8Array {
  return concat(slipEncode(payload), bytes(SLIP_END));
}

export const pingRequest = (id: number): Uint8Array => bytes(OP_PING, id & 0xff);
export const setPrnRequest = (prn: number): Uint8Array =>
  bytes(OP_SET_PRN, prn & 0xff, (prn >> 8) & 0xff);
export const getMtuRequest = (): Uint8Array => bytes(OP_GET_MTU);
export const selectRequest = (objectType: number): Uint8Array =>
  bytes(OP_SELECT, objectType);
export const createRequest = (objectType: number, size: number): Uint8Array =>
  concat(bytes(OP_CREATE, objectType), int32LE(size));
export const writeRequest = (chunk: Uint8Array): Uint8Array =>
  concat(bytes(OP_WRITE), chunk);
export const calcCrcRequest = (): Uint8Array => bytes(OP_CALC_CRC);
export const executeRequest = (): Uint8Array => bytes(OP_EXECUTE);

export interface DfuResponse {
  op: number;
  result: number;
  payload: Uint8Array;
}

/** The response in a decoded frame, or null for a frame that is not one. */
export function parseResponse(frame: Uint8Array): DfuResponse | null {
  if (frame.length < 3 || frame[0] !== OP_RESPONSE) return null;
  return { op: frame[1], result: frame[2], payload: frame.subarray(3) };
}

/** What a failed response says, in words. */
export function responseFailure(res: DfuResponse): string {
  if (res.result === RESULT_EXTENDED_ERROR) {
    const code = res.payload[0];
    const detail = EXTENDED_ERRORS[code] ?? `unknown extended error ${code}`;
    return `the bootloader refused it: ${detail}`;
  }
  const name = RESULT_NAMES[res.result] ?? `result 0x${res.result.toString(16)}`;
  return `the bootloader answered ${name}`;
}

/**
 * The data bytes per Write frame for a serial MTU: pc-nrfutil's bound,
 * where SLIP can double the frame and the opcode takes a byte.
 */
export function writeChunkSize(mtu: number): number {
  const size = Math.floor((mtu - 1) / 2) - 1;
  if (size < 1) throw new Error(`The bootloader's serial MTU (${mtu}) is too small`);
  return size;
}

const u16 = (payload: Uint8Array, at: number): number =>
  new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint16(
    at,
    true
  );
const u32 = (payload: Uint8Array, at: number): number =>
  new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(
    at,
    true
  );

// ── Session ──────────────────────────────────────────────────────────────────

interface Pending {
  resolve: (frame: Uint8Array) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class SecureDfuSession extends SlipFrameSession {
  private pending: Pending | null = null;
  private pingId = 0;
  private mtu = 0;

  constructor(
    port: SerialPort,
    signal: AbortSignal | undefined,
    private readonly log: (line: string) => void
  ) {
    super(port, signal);
  }

  protected onEnded(err: Error): void {
    this.pending?.reject(err);
  }

  protected onFrame(frame: Uint8Array): void {
    const pending = this.pending;
    if (!pending) return; // Nothing asked: leftovers from an earlier session.
    this.pending = null;
    clearTimeout(pending.timer);
    pending.resolve(frame);
  }

  /** Send one request and take the next frame as its answer. */
  private exchange(payload: Uint8Array, timeoutMs: number): Promise<Uint8Array> {
    if (this.readEnded) return Promise.reject(this.readEnded);
    const reply = new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`No answer from the bootloader in ${timeoutMs} ms`)),
        timeoutMs
      );
      this.pending = { resolve, reject, timer };
    });
    reply.catch(() => {}); // A wait given up on (a failed write) is not unhandled.
    const answered = this.writeBytes(frameRequest(payload)).then(() => reply);
    return this.race(answered).finally(() => {
      if (this.pending) clearTimeout(this.pending.timer);
      this.pending = null;
    });
  }

  /** A request the bootloader must answer with success; its payload. */
  private async request(payload: Uint8Array): Promise<Uint8Array> {
    const op = payload[0];
    const name = OP_NAMES[op] ?? `opcode 0x${op.toString(16)}`;
    const res = parseResponse(await this.exchange(payload, RESPONSE_TIMEOUT_MS));
    if (!res || res.op !== op) {
      throw new DfuResponseError(name, "the bootloader answered something else");
    }
    if (res.result !== RESULT_SUCCESS)
      throw new DfuResponseError(name, responseFailure(res));
    return res.payload;
  }

  /** The bootloader is up when it answers a ping at all; a stale frame is tried past. */
  async ping(): Promise<void> {
    for (let attempt = 1; attempt <= PING_ATTEMPTS; attempt++) {
      const id = (this.pingId = (this.pingId + 1) & 0xff);
      let frame: Uint8Array;
      try {
        frame = await this.exchange(pingRequest(id), PING_TIMEOUT_MS);
      } catch (err) {
        if (this.signal?.aborted || this.readEnded || attempt === PING_ATTEMPTS)
          throw err;
        continue;
      }
      const res = parseResponse(frame);
      if (
        res?.op === OP_PING &&
        (res.result !== RESULT_SUCCESS || res.payload[0] === id)
      ) {
        return;
      }
    }
    throw new Error(`The bootloader did not answer the ping (${PING_ATTEMPTS} attempts)`);
  }

  async setPrn(prn: number): Promise<void> {
    await this.request(setPrnRequest(prn));
  }

  async getMtu(): Promise<number> {
    this.mtu = u16(await this.request(getMtuRequest()), 0);
    return this.mtu;
  }

  async select(
    objectType: number
  ): Promise<{ maxSize: number; offset: number; crc: number }> {
    const p = await this.request(selectRequest(objectType));
    return { maxSize: u32(p, 0), offset: u32(p, 4), crc: u32(p, 8) };
  }

  async create(objectType: number, size: number): Promise<void> {
    await this.request(createRequest(objectType, size));
  }

  async execute(): Promise<void> {
    await this.request(executeRequest());
  }

  /**
   * Write ``data`` as the open object, then have the bootloader confirm it
   * holds exactly what was sent. ``offset`` and ``crc`` are the transfer so
   * far, which the bootloader's figures continue; returns the new CRC.
   */
  async stream(data: Uint8Array, offset: number, crc: number): Promise<number> {
    const chunk = writeChunkSize(this.mtu);
    for (let at = 0; at < data.length; at += chunk) {
      const piece = data.subarray(at, at + chunk);
      await this.writeBytes(frameRequest(writeRequest(piece)));
      crc = crc32(piece, crc);
    }
    const end = offset + data.length;
    const p = await this.request(calcCrcRequest());
    const got = { offset: u32(p, 0), crc: u32(p, 4) };
    if (got.offset !== end || got.crc !== crc) {
      throw new Error(
        `The bootloader holds ${got.offset} bytes with CRC 0x${got.crc.toString(16)}, ` +
          `expected ${end} bytes with CRC 0x${crc.toString(16)}`
      );
    }
    return crc;
  }

  /** The init packet as the command object; its execute validates the update. */
  async sendInitPacket(dat: Uint8Array): Promise<void> {
    const { maxSize } = await this.select(OBJECT_COMMAND);
    if (dat.length > maxSize) {
      throw new Error(
        `The init packet (${dat.length} bytes) is larger than the bootloader takes (${maxSize})`
      );
    }
    this.log(`Sending the init packet (${dat.length} bytes)`);
    // A new command object resets the bootloader's stored progress, so the
    // data starts from offset 0 whatever an earlier attempt left behind.
    await this.create(OBJECT_COMMAND, dat.length);
    await this.stream(dat, 0, 0);
    await this.execute();
  }

  /** The image as data objects of the size the bootloader names (a flash page). */
  async sendFirmware(bin: Uint8Array, onPercent: (p: number) => void): Promise<void> {
    const { maxSize } = await this.select(OBJECT_DATA);
    const objects = Math.ceil(bin.length / maxSize);
    this.log(
      `Transferring ${bin.length} bytes in ${objects} objects of up to ${maxSize} bytes`
    );
    const tenth = tenthLogger(this.log, "Transferring");
    let crc = 0;
    for (let i = 0; i < objects; i++) {
      const offset = i * maxSize;
      const piece = bin.subarray(offset, offset + maxSize);
      await this.create(OBJECT_DATA, piece.length);
      crc = await this.stream(piece, offset, crc);
      await this.execute();
      const percent = Math.floor(((i + 1) / objects) * 100);
      onPercent(percent);
      tenth(percent);
    }
    onPercent(100);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the Secure DFU sequence on a closed port (opened at 115200, closed
 * after). The bootloader starts the new firmware itself once the last object
 * executes, so the device re-enumerates as the application on its own. The
 * abort in ``options`` stops between frames and releases the port; the
 * bootloader stays in DFU mode for a retry.
 */
export async function flashSecureDfuPackage(
  port: SerialPort,
  pkg: DfuPackage,
  { onProgress, onLog, signal }: DfuFlashHooks
): Promise<void> {
  const log = onLog ?? (() => {});
  if (!port.readable) {
    log("Opening the DFU port at 115200 baud");
    await port.open({ baudRate: 115200 });
  }
  let session: SecureDfuSession | undefined;
  let failure: unknown;
  try {
    session = new SecureDfuSession(port, signal, log);
    log("Pinging the bootloader");
    await session.ping();
    await session.setPrn(0);
    log(`Serial MTU: ${await session.getMtu()} bytes`);
    for (let i = 0; i < pkg.parts.length; i++) {
      const part = pkg.parts[i];
      const base = (i / pkg.parts.length) * 100;
      const range = 100 / pkg.parts.length;
      onProgress(base);
      log(
        `Image ${i + 1} of ${pkg.parts.length}: ${part.type} (${part.bin.length} bytes)`
      );
      await session.sendInitPacket(part.dat);
      await session.sendFirmware(part.bin, (pct) =>
        onProgress(base + (pct * range) / 100)
      );
    }
    log("Transfer complete; the bootloader starts the firmware");
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    markSerialActivity(); // the bootloader reboots into the firmware; its return is ours
    // Both are best effort: the port must always be closed so a retry can
    // reopen it, and neither may replace the error that ended the flash.
    try {
      await session?.close(failure);
    } catch {
      // ignore
    }
    try {
      await port.close();
    } catch {
      // ignore
    }
  }
}
