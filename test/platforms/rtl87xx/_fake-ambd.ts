/**
 * A simulated RTL8720D behind a fake Web Serial port, as the BW16 kit on its
 * USB port behaves: an ESP-style auto-download circuit holds the reset while
 * RTS alone is asserted and the strap while DTR alone is, so a reset released
 * with the strap held (or the user's strap) lands in the ROM downloader, which answers register reads, takes address-prefixed
 * XModem-1k into RAM, and NAKs while it idles; a loader written to its
 * address takes over, prints its banner, and adds the flash commands
 * (id, erase, write through the XIP window, checksum). A reset with DTR
 * released boots the application, which answers nothing.
 */
import type { WireFrame } from "../_reference-frames.js";
import {
  BW16_PARTITIONS,
  ltHeaderTags,
  ltPartInfoTags,
  ltPartitionTable,
  makeLibreTinyUf2,
} from "../../_make-libretiny-uf2.js";
import { fakeSerialPort } from "../../_web-serial.js";
import { UF2_FAMILY_AMBD } from "../../../src/platforms/rtl87xx/ambd-image.js";
import { checksum32 } from "../../../src/platforms/rtl87xx/ambd-link.js";
import { crc16Xmodem } from "../../../src/util/xmodem.js";

const FLASH_SIZE = 0x400000;
const SECTOR = 0x1000;
const LOADER_ADDRESS = 0x82000;
const RAM_SIZE = 0x8000;
const NAK = 0x15;
const ACK = 0x06;
const STX = 0x02;
const EOT = 0x04;
const CAN = 0x18;
const CRC_REQUEST = 0x43;
/** What a JEDEC id read says: XMC, with the size's log2 as the third byte (0x16: 4 MiB). */
const FLASH_ID = [0x20, 0x40];
const FLASH_SIZE_LOG2 = 0x16;
const BANNER = new TextEncoder().encode("UARTIMG_Download 2\n\r");
/** The AmebaD image signature, at the head of a slot that holds a valid image. */
export const IMAGE_SIGNATURE = new TextEncoder().encode("81958711");
export const OTA1_OFFSET = 0x6000;
export const OTA2_OFFSET = 0x206000;
/** The stand-in flash loader the tests and the transcript recorder agree on. */
export const STAND_IN_LOADER = Uint8Array.from(
  { length: 4688 },
  (_, i) => (i * 3 + 1) % 255
);

/** What the flash holds before the flash: never FF, so an erase shows; built once, copied per chip. */
const OLD_FLASH = new Uint8Array(FLASH_SIZE);
for (let i = 0; i < FLASH_SIZE; i++) OLD_FLASH[i] = (i * 7 + 3) % 251;

export interface FakeAmbdOptions {
  /** The loader already runs from a previous session. */
  loaderResident?: boolean;
  /** Fail setSignals as an adapter without control lines would. */
  noSignals?: boolean;
  /** Never settle a line change, as on an adapter unplugged mid change. */
  hangSignals?: boolean;
  /** Resets that do not reach the chip before one does (a CH340's first session). */
  lostResets?: number;
  /** NAK the first block of every transfer once. */
  nakFirstBlock?: boolean;
  /** Ask for CRC blocks ("C") instead of NAKing for the first block. */
  asksForCrc?: boolean;
  /** Answer every checksum query with zeros. */
  badChecksum?: boolean;
  /** The loader never starts after it is written (its first word stays unanswered). */
  loaderDead?: boolean;
  /** A valid image signature sits at the head of the second slot. */
  ota2Valid?: boolean;
  /** The flash size the JEDEC id reports, as its log2 (the default is 4 MiB). */
  flashSizeLog2?: number;
  /**
   * Whether the ROM and the loader NAK after every reply and on every reset,
   * as the real chip does while it idles. Off for the transcript test, whose
   * recorder's chip answers only what a command asks for.
   */
  idleNaks?: boolean;
}

export function fakeAmbd(opts: FakeAmbdOptions = {}) {
  const frames: WireFrame[] = [];
  const bauds: number[] = [];
  const commands: string[] = [];
  const flash = OLD_FLASH.slice();
  if (opts.ota2Valid) flash.set(IMAGE_SIGNATURE, OTA2_OFFSET);
  const ram = Uint8Array.from({ length: RAM_SIZE }, (_, i) => (i * 13 + 5) % 253);
  const erased = new Set<number>();
  let rom = opts.loaderResident ?? false;
  let loaderUp = opts.loaderResident ?? false;
  let dtr = false;
  let rts = false;
  let inReset = false;
  let resets = 0;
  let booted = 0;
  let pending: number[] = [];
  let xmodem: { buf: number[]; crc: boolean; naked: boolean } | null = null;

  const reply = (data: number[] | Uint8Array) => {
    const bytes = new Uint8Array(data);
    frames.push({ dir: "rx", bytes });
    link.enqueue(bytes);
  };
  /** The ROM and the loader NAK after every reply, as they do while idle. */
  const idleNak = () => {
    if (opts.idleNaks ?? true) reply([NAK]);
  };

  const endTransfer = () => {
    const wasLoader = xmodem !== null && !loaderUp;
    xmodem = null;
    reply([ACK]);
    if (wasLoader && !opts.loaderDead) {
      loaderUp = true;
      reply(BANNER);
    }
    idleNak();
  };

  const xmodemByte = (byte: number) => {
    const x = xmodem!;
    if (x.buf.length === 0 && byte === EOT) {
      endTransfer();
      return;
    }
    if (x.buf.length === 0 && byte === CAN) {
      xmodem = null;
      return;
    }
    x.buf.push(byte);
    const frameLength = 3 + 1028 + (x.crc ? 2 : 1);
    if (x.buf.length < frameLength) return;
    const block = x.buf.splice(0);
    if (block[0] !== STX || block[1] + block[2] !== 0xff) throw new Error("block header");
    const payload = block.slice(3, 3 + 1028);
    if (x.crc) {
      const crc = crc16Xmodem(new Uint8Array(payload));
      if (block[3 + 1028] !== crc >> 8 || block[4 + 1028] !== (crc & 0xff)) {
        throw new Error("block crc");
      }
    } else if ((payload.reduce((a, b) => a + b, 0) & 0xff) !== block[3 + 1028]) {
      throw new Error("block checksum");
    }
    if (opts.nakFirstBlock && !x.naked) {
      x.naked = true;
      reply([NAK]);
      return;
    }
    const address =
      (payload[0] | (payload[1] << 8) | (payload[2] << 16) | (payload[3] << 24)) >>> 0;
    const data = payload.slice(4);
    if (address >>> 24 === 0x08) {
      if (!loaderUp) throw new Error("flash write without the loader");
      const offset = address & 0xffffff;
      // Every sector the block touches, the padded tail included.
      for (let at = offset - (offset % SECTOR); at < offset + data.length; at += SECTOR) {
        if (!erased.has(at))
          throw new Error(`write to unerased sector 0x${at.toString(16)}`);
      }
      flash.set(data, offset);
    } else if (
      address >= LOADER_ADDRESS &&
      address + data.length <= LOADER_ADDRESS + RAM_SIZE
    ) {
      ram.set(data, address - LOADER_ADDRESS);
    } else {
      throw new Error(`write outside RAM and flash: 0x${address.toString(16)}`);
    }
    reply([ACK]);
  };

  const argument = () => {
    const [cmd] = pending;
    if (cmd === 0x31 && pending.length === 5) {
      const address =
        (pending[1] | (pending[2] << 8) | (pending[3] << 16) | (pending[4] << 24)) >>> 0;
      pending = [];
      commands.push(`read 0x${address.toString(16)}`);
      const word =
        address >= LOADER_ADDRESS && address + 4 <= LOADER_ADDRESS + RAM_SIZE
          ? Array.from(
              ram.subarray(address - LOADER_ADDRESS, address - LOADER_ADDRESS + 4)
            )
          : [0, 0, 0, 0];
      reply([0x31, ...word, NAK]);
    } else if (cmd === 0x21 && pending.length === 3) {
      pending = [];
      commands.push("flash id");
      if (loaderUp) reply([0x21, ...FLASH_ID, opts.flashSizeLog2 ?? FLASH_SIZE_LOG2]);
      idleNak();
    } else if (cmd === 0x17 && pending.length === 6) {
      const offset = pending[1] | (pending[2] << 8) | (pending[3] << 16);
      const count = pending[4] | (pending[5] << 8);
      pending = [];
      commands.push(`erase 0x${offset.toString(16)} x${count}`);
      if (!loaderUp) return;
      for (let i = 0; i < count; i++) {
        flash.fill(0xff, offset + i * SECTOR, offset + (i + 1) * SECTOR);
        erased.add(offset + i * SECTOR);
      }
      reply([ACK]);
      idleNak();
    } else if (cmd === 0x27 && pending.length === 7) {
      const offset = pending[1] | (pending[2] << 8) | (pending[3] << 16);
      const length = pending[4] | (pending[5] << 8) | (pending[6] << 16);
      pending = [];
      commands.push(`checksum 0x${offset.toString(16)}+${length}`);
      if (!loaderUp) return;
      const sum = opts.badChecksum
        ? 0
        : checksum32(flash.subarray(offset, offset + length));
      reply([0x27, sum & 0xff, (sum >>> 8) & 0xff, (sum >>> 16) & 0xff, sum >>> 24]);
      idleNak();
    }
  };

  const start = (byte: number) => {
    if (byte === CAN) return;
    if (byte === 0x07) {
      commands.push("xmodem");
      reply([ACK]);
      xmodem = { buf: [], crc: opts.asksForCrc ?? false, naked: false };
      reply([opts.asksForCrc ? CRC_REQUEST : NAK]);
    } else if ([0x31, 0x21, 0x17, 0x27].includes(byte)) {
      pending = [byte];
    }
  };

  const feed = (chunk: Uint8Array) => {
    frames.push({ dir: "tx", bytes: new Uint8Array(chunk) });
    if (!rom) return;
    for (const byte of chunk) {
      if (xmodem) xmodemByte(byte);
      else if (pending.length) {
        pending.push(byte);
        argument();
      } else start(byte);
    }
  };

  const link = fakeSerialPort({
    feed,
    noSignals: opts.noSignals,
    hangSignals: opts.hangSignals,
    onOpen: ({ baudRate }) => {
      bauds.push(baudRate);
      if (rom) idleNak();
    },
    onSignals: (s) => {
      if (s.dataTerminalReady !== undefined) dtr = s.dataTerminalReady;
      if (s.requestToSend !== undefined) rts = s.requestToSend;
      // The kit's circuit: reset held while RTS alone is asserted, the strap
      // while DTR alone is; both asserted pull nothing. The chip samples the
      // strap as the reset is released.
      const wasReset = inReset;
      inReset = rts && !dtr;
      if (wasReset && !inReset) {
        if (++resets <= (opts.lostResets ?? 0)) return;
        pending = [];
        xmodem = null;
        loaderUp = false;
        rom = dtr && !rts;
        if (rom) idleNak();
        else booted++;
      }
    },
  });
  return {
    ...link,
    frames,
    bauds,
    commands,
    flash,
    ram,
    erased,
    /** The user's strap: the ROM answers from now on. */
    strap: () => {
      rom = true;
      loaderUp = false;
      idleNak();
    },
    get loaderUp() {
      return loaderUp;
    },
    /** Resets with the strap released: the application booted. */
    get booted() {
      return booted;
    },
  };
}

/** The recorded fixture's UF2 (record-ambd.py builds it), read from the repo root as the tests run. */
export async function fixtureAmbdUf2(): Promise<Uint8Array> {
  // @ts-expect-error - node-only module (see gen-language-manifest.test.ts)
  const { readFileSync } = await import("node:fs");
  return new Uint8Array(readFileSync("test/platforms/rtl87xx/fixtures/ambd.uf2"));
}

/** A small bw16 build: one run in ``ota1`` of ten blocks and a bit, so the last XModem block is short. */
export function makeAmbdUf2(blocks = 11): Uint8Array<ArrayBuffer> {
  return makeLibreTinyUf2({
    family: UF2_FAMILY_AMBD,
    headerTags: ltHeaderTags({
      BOARD: "bw16",
      FAL_PTABLE: ltPartitionTable(BW16_PARTITIONS),
    }),
    blocks: Array.from({ length: blocks }, (_, i) => ({
      addr: i * 256,
      data:
        i === blocks - 1
          ? new Uint8Array(40).map((_, j) => (j * 31 + 7) % 253)
          : undefined,
      fill: i === blocks - 1 ? undefined : (i * 17 + 1) % 251,
      tags: i === 0 ? ltPartInfoTags([0, 1, 2, 0, 1, 2], ["ota1", "ota2"]) : undefined,
    })),
  });
}
