/**
 * A simulated Beken chip behind a fake Web Serial port: commands in the
 * writable are answered on the readable, against a flash it keeps. The
 * same model as the one in ``fixtures/record.py``, which bk7231tools was
 * run against to record what it puts on the wire.
 *
 * It is built from what bk7231tools expects to read back, not from a real
 * chip.
 */
import { vi } from "vitest";
import { disconnectEvents } from "../../_web-serial.js";
import type { LibreTinyImage } from "../../../src/platforms/libretiny-uf2.js";
import { concat } from "../../../src/util/bytes.js";
import { crc32 } from "../../../src/util/crc32.js";

export const FLASH_SIZE = 0x200000;
const SECTOR = 0x1000;

/** What the flash holds before the flash: never FF, so an erase shows. */
export const oldByte = (i: number): number => (i * 7 + 3) % 251;
/** The image's bytes, by offset in its run. */
export const newByte = (i: number): number => (i * 31 + 7) % 253;

const bytesOf = (length: number, at: (i: number) => number) =>
  Uint8Array.from({ length }, (_, i) => at(i));

/**
 * Three sectors (data, all FF, a partial one) and the small run a real
 * build puts inside the last sector of the app partition.
 */
export function referenceImage(familyId: number): LibreTinyImage {
  const first = bytesOf(2 * SECTOR + 1000, newByte);
  first.fill(0xff, SECTOR, 2 * SECTOR);
  const runs = [
    { address: 0x11000, data: first },
    { address: 0x129f0a, data: bytesOf(102, newByte) },
  ];
  return {
    familyId,
    board: "generic",
    runs,
    totalBytes: runs.reduce((n, r) => n + r.data.length, 0),
  };
}

export interface ChipSpec {
  protocol: "FULL" | "BASIC_BEKEN" | "BASIC_TUYA";
  /** What the chip answers for the bootloader's CRC; null computes it from the flash. */
  boot_crc: number | null;
  chip_id?: number;
  flash_id?: string;
  sr?: number;
  boot_version?: string;
}

export interface FakeOptions {
  /** LinkChecks the chip lets pass before it answers one. */
  linkAfter?: number;
  /** The chip answers only once it was reset this many times. */
  resetsNeeded?: number;
  /** Fail setSignals as an adapter without control lines would. */
  noSignals?: boolean;
  /** The status register keeps its protection bits whatever is written. */
  stuckProtection?: boolean;
  /** CRCs of a written range that come back wrong before one is right. */
  badCrcs?: number;
  /** Bytes that are not a response, sent ahead of every response. */
  noise?: Uint8Array;
  /** FlashWrite4K commands that are taken and never answered. */
  swallowWrites?: number;
  /** A response of another command, sent ahead of the answer to a CRC. */
  strayResponse?: boolean;
  /** Erases are answered and do nothing, with the status register clear. */
  deadErase?: boolean;
  /** The CRC of the range a protocol is told by fits neither protocol. */
  oddProbeCrc?: boolean;
  /** Sector reads that come back with a status, or short, before one is right. */
  badReads?: number;
  shortReads?: number;
  /** An address past the flash reads as nothing, so its size cannot be told. */
  noWrapAround?: boolean;
  /** LinkChecks after a CRC that the chip lets pass, this many times a second long. */
  deafAfterCrc?: number;
  /** A page write reports fewer bytes than it was given. */
  shortPageWrites?: boolean;
}

export interface Frame {
  dir: "tx" | "rx";
  bytes: Uint8Array;
  /** ``Date.now()`` when the frame was whole. */
  at: number;
}

const u32 = (bytes: Uint8Array, at: number) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);
const le32 = (v: number) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, v >>> 0, true);
  return out;
};

export function fakeBeken(spec: ChipSpec, opts: FakeOptions = {}) {
  let out!: ReadableStreamDefaultController<Uint8Array>;
  const full = spec.protocol === "FULL";
  const flash = bytesOf(FLASH_SIZE, oldByte);
  const frames: Frame[] = [];
  const signals: SerialOutputSignals[] = [];
  let sr = spec.sr ?? 0;
  // A bootloader protects the flash after a CRC until a LinkCheck.
  let locked = false;
  let rx: number[] = [];
  let linkChecks = 0;
  let resets = 0;
  let badCrcs = opts.badCrcs ?? 0;
  let swallow = opts.swallowWrites ?? 0;
  let wrote = false;
  let deaf = opts.deafAfterCrc ?? 0;
  let deafUntil = 0;
  let badReads = opts.badReads ?? 0;
  let shortReads = opts.shortReads ?? 0;

  const reply = (code: number, long: boolean, payload: Uint8Array) => {
    const head = long
      ? [0x04, 0x0e, 0xff, 0x01, 0xe0, 0xfc, 0xf4]
      : [0x04, 0x0e, payload.length + 4, 0x01, 0xe0, 0xfc, code];
    const size = payload.length + 1;
    const tail = long ? [size & 0xff, size >> 8, code] : [];
    const frame = concat(new Uint8Array([...head, ...tail]), payload);
    frames.push({ dir: "rx", bytes: frame, at: Date.now() });
    out.enqueue(opts.noise ? concat(opts.noise, frame) : frame);
  };

  const writable = () => (full ? !(sr & 0x7c) : !locked);
  const at = (address: number) => address % FLASH_SIZE;

  const crcOf = (start: number, end: number): number => {
    const last = full ? end + 1 : end;
    if (
      spec.boot_crc !== null &&
      at(start) === 0 &&
      (last - start === 256 || last - start === 257)
    ) {
      return (spec.boot_crc ^ 0xffffffff) >>> 0;
    }
    const data = bytesOf(last - start, (i) => flash[at(start + i)]);
    const odd = opts.oddProbeCrc && at(start) === 0x11000 && last - start <= 257;
    return (crc32(data) ^ (odd ? 0xfffffffe : 0xffffffff)) >>> 0;
  };

  const program = (start: number, data: Uint8Array) => {
    if (!writable()) return;
    data.forEach((b, i) => (flash[at(start + i)] &= b));
    wrote = true;
  };

  const answer = (code: number, long: boolean, p: Uint8Array) => {
    const known = (() => {
      if (!long && code === 0x00) {
        if (resets < (opts.resetsNeeded ?? 0)) return true;
        if (Date.now() < deafUntil) return true;
        if (linkChecks++ < (opts.linkAfter ?? 0)) return true;
        locked = false;
        reply(0x01, false, new Uint8Array([0]));
        return true;
      }
      if (!long && code === 0x03 && full) {
        const address = u32(p, 0);
        const value = address === 0x800000 ? (spec.chip_id ?? 0) : 0;
        reply(0x03, false, concat(le32(address), le32(value)));
        return true;
      }
      // Reboot: no answer.
      if (!long && code === 0x0e) return true;
      if (!long && code === 0x10) {
        let crc = crcOf(u32(p, 0), u32(p, 4));
        if (wrote && badCrcs > 0) {
          badCrcs--;
          crc ^= 1;
        }
        if (opts.strayResponse) reply(0x01, false, new Uint8Array([0]));
        reply(0x10, false, le32(crc));
        if (!full) locked = true;
        if (wrote && deaf-- > 0) deafUntil = Date.now() + 1500;
        return true;
      }
      if (!long && code === 0x11 && spec.protocol === "BASIC_TUYA") {
        reply(0x11, false, new TextEncoder().encode(spec.boot_version ?? ""));
        return true;
      }
      if (long && code === 0x06) {
        const data = p.subarray(4);
        program(u32(p, 0), data);
        reply(
          0x06,
          true,
          concat(
            new Uint8Array([0]),
            p.subarray(0, 4),
            new Uint8Array([data.length - (opts.shortPageWrites ? 1 : 0)])
          )
        );
        return true;
      }
      if (long && code === 0x07) {
        if (swallow > 0) {
          swallow--;
          return true;
        }
        program(u32(p, 0), p.subarray(4));
        reply(0x07, true, concat(new Uint8Array([0]), p.subarray(0, 4)));
        return true;
      }
      if (long && code === 0x09) {
        const start = u32(p, 0);
        const past = opts.noWrapAround && start >= FLASH_SIZE;
        const length = shortReads-- > 0 ? SECTOR - 1 : SECTOR;
        const data = bytesOf(length, (i) => (past ? 0 : flash[at(start + i)]));
        const status = badReads-- > 0 ? 1 : 0;
        reply(0x09, true, concat(new Uint8Array([status]), p.subarray(0, 4), data));
        return true;
      }
      if (long && code === 0x0c && full) {
        const value = p[0] === 0x35 ? (sr >> 8) & 0xff : sr & 0xff;
        reply(0x0c, true, new Uint8Array([0, p[0], value]));
        return true;
      }
      if (long && code === 0x0d && full) {
        const value = p.length === 2 ? (sr & 0xff00) | p[1] : p[1] | (p[2] << 8);
        if (!opts.stuckProtection) sr = value;
        reply(0x0d, true, concat(new Uint8Array([0]), p));
        return true;
      }
      if (long && code === 0x0e && full) {
        const id = (spec.flash_id ?? "").match(/../g)!.map((h) => parseInt(h, 16));
        reply(0x0e, true, new Uint8Array([0, 0, ...id]));
        return true;
      }
      if (long && code === 0x0f) {
        if (writable() && !opts.deadErase) {
          const base = at(u32(p, 1)) & ~(SECTOR - 1);
          flash.fill(0xff, base, base + SECTOR);
        }
        reply(0x0f, true, concat(new Uint8Array([0]), p));
        return true;
      }
      return false;
    })();
    if (!known) {
      throw new Error(
        `Command the chip does not know: ${code.toString(16)} long=${long}`
      );
    }
  };

  const take = (): boolean => {
    if (rx.length < 5) return false;
    const long = rx[3] === 0xff;
    if (long && rx.length < 8) return false;
    const size = long ? rx[5] | (rx[6] << 8) : rx[3];
    const head = long ? 7 : 4;
    if (rx.length < head + size) return false;
    const frame = new Uint8Array(rx.splice(0, head + size));
    frames.push({ dir: "tx", bytes: frame, at: Date.now() });
    answer(frame[head], long, frame.subarray(head + 1));
    return true;
  };

  const feed = (chunk: Uint8Array) => {
    rx.push(...chunk);
    while (take());
  };

  // Like a freshly picked port: no streams until open().
  const port = {
    ...disconnectEvents(),
    readable: null as ReadableStream<Uint8Array> | null,
    writable: null as WritableStream<Uint8Array> | null,
    open: vi.fn(async () => {
      port.readable = new ReadableStream<Uint8Array>({ start: (c) => (out = c) });
      port.writable = new WritableStream<Uint8Array>({ write: feed });
    }),
    close: vi.fn(async () => {}),
    setSignals: vi.fn(async (s: SerialOutputSignals) => {
      if (opts.noSignals) throw new DOMException("no lines", "NetworkError");
      signals.push(s);
      // The chip comes out of reset when RTS is released after being held.
      const held = signals.some((x) => x.requestToSend === true);
      if (s.requestToSend === false && s.dataTerminalReady === undefined && held) {
        resets++;
        rx = [];
      }
    }),
  };
  return {
    port: port as unknown as SerialPort,
    raw: port,
    flash,
    frames,
    signals,
    sent: () => frames.filter((f) => f.dir === "tx").map((f) => f.bytes),
    statusRegister: () => sr,
    /** The user resets the chip by hand. */
    reset: () => {
      resets = Number.MAX_SAFE_INTEGER;
    },
    dropLink: () => out.close(),
  };
}

export type FakeBeken = ReturnType<typeof fakeBeken>;
