/**
 * A simulated RTL8720D behind a fake Web Serial port, as the BW16 kit on a
 * CH340 behaves: a reset with DTR held (or the user's strap) lands in the
 * ROM downloader, which answers register reads, takes address-prefixed
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
/** What a JEDEC id read says: XMC, 4 MiB. */
const FLASH_ID = [0x20, 0x40, 0x16];
const BANNER = new TextEncoder().encode("UARTIMG_Download 2\n\r");
/** The AmebaD image signature, at the head of a slot that holds a valid image. */
export const IMAGE_SIGNATURE = new TextEncoder().encode("81958711");
export const OTA1_OFFSET = 0x6000;
export const OTA2_OFFSET = 0x206000;

/** What the flash holds before the flash: never FF, so an erase shows; built once, copied per chip. */
const OLD_FLASH = Uint8Array.from({ length: FLASH_SIZE }, (_, i) => (i * 7 + 3) % 251);

export interface FakeAmbdOptions {
  /** In the ROM already (the default is the application, deaf until a reset or ``strap()``). */
  strapped?: boolean;
  /** The loader already runs from a previous session (implies ``strapped``). */
  loaderResident?: boolean;
  /** Fail setSignals as an adapter without control lines would. */
  noSignals?: boolean;
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
}

export function fakeAmbd(opts: FakeAmbdOptions = {}) {
  const frames: WireFrame[] = [];
  const bauds: number[] = [];
  const commands: string[] = [];
  const flash = OLD_FLASH.slice();
  if (opts.ota2Valid) flash.set(IMAGE_SIGNATURE, OTA2_OFFSET);
  const ram = Uint8Array.from({ length: RAM_SIZE }, (_, i) => (i * 13 + 5) % 253);
  const erased = new Set<number>();
  let rom = (opts.strapped ?? false) || (opts.loaderResident ?? false);
  let loaderUp = opts.loaderResident ?? false;
  let dtr = false;
  let rts = false;
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
  const idleNak = () => reply([NAK]);

  const sum32 = (offset: number, length: number): number => {
    let sum = 0;
    const words = length - (length % 4);
    const view = new DataView(flash.buffer, offset, length);
    for (let i = 0; i < words; i += 4) sum = (sum + view.getUint32(i, true)) >>> 0;
    for (let i = words; i < length; i++) {
      sum = (sum + flash[offset + i] * 2 ** ((i - words) * 8)) >>> 0;
    }
    return sum;
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
      for (let i = 0; i < data.length; i += SECTOR) {
        const sector = offset + i - ((offset + i) % SECTOR);
        if (!erased.has(sector))
          throw new Error(`write to unerased sector 0x${sector.toString(16)}`);
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
      if (loaderUp) reply([0x21, ...FLASH_ID]);
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
      const sum = opts.badChecksum ? 0 : sum32(offset, length);
      reply([0x27, sum & 0xff, (sum >>> 8) & 0xff, (sum >>> 16) & 0xff, sum >>> 24]);
      idleNak();
    } else if (cmd === 0x05 && pending.length === 2) {
      pending = [];
      commands.push(`baud index 0x${pending[1]?.toString(16)}`);
      reply([ACK]);
    }
  };

  const start = (byte: number) => {
    if (byte === CAN) return;
    if (byte === 0x07) {
      commands.push("xmodem");
      reply([ACK]);
      xmodem = { buf: [], crc: opts.asksForCrc ?? false, naked: false };
      reply([opts.asksForCrc ? CRC_REQUEST : NAK]);
    } else if ([0x31, 0x21, 0x17, 0x27, 0x05].includes(byte)) {
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
    onOpen: ({ baudRate }) => {
      bauds.push(baudRate);
      if (rom) idleNak();
    },
    onSignals: (s) => {
      if (s.dataTerminalReady !== undefined) dtr = s.dataTerminalReady;
      const wasRts = rts;
      if (s.requestToSend !== undefined) rts = s.requestToSend;
      // RTS falling edge: the reset the kit's wiring gives.
      if (wasRts && !rts) {
        if (++resets <= (opts.lostResets ?? 0)) return;
        pending = [];
        xmodem = null;
        loaderUp = false;
        rom = dtr;
        if (!dtr) booted++;
        if (rom) idleNak();
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
