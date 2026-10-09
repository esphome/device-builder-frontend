/**
 * The Realtek AmebaD (RTL8720D) ROM downloader's byte protocol and the RAM
 * flash loader's, as ltchiptool speaks them: single-byte commands answered
 * with ACK, a register read that doubles as the "is the ROM there" probe,
 * and memory writes over XModem-1k whose blocks carry their target address
 * in front of the data. The ROM only writes RAM; the loader it is given
 * writes flash, addressed through the XIP window.
 */
import { int32LE } from "../../util/bytes.js";
import { SerialByteSession } from "../../util/serial-byte-session.js";
import { sleep } from "../../util/sleep.js";
import {
  awaitStart,
  buildBlock,
  EOT_FRAME,
  sendFrame,
  XMODEM_BLOCK_SIZE,
  type XmodemIo,
  XmodemNoStartError,
} from "../../util/xmodem.js";

/** Where the flash loader runs (KM0 SRAM), and where the ROM reads to find it. */
export const AMBD_LOADER_ADDRESS = 0x82000;
/**
 * Flash is written through the XIP window: a raw flash offset lands in the
 * RAM the loader runs from (every block ACKed, nothing programmed).
 */
export const AMBD_FLASH_ADDRESS = 0x08000000;
export const AMBD_SECTOR_SIZE = 0x1000;

const ACK = 0x06;
const NAK = 0x15;
const CAN = 0x18;
const CMD_XMODEM = 0x07;
const CMD_ERASE = 0x17;
const CMD_FLASH_STATUS = 0x21;
const CMD_CHECKSUM = 0x27;
const CMD_READ_WORD = 0x31;
/** The JEDEC id read: the ``9F`` opcode and its three reply bytes. */
const FLASH_ID_REQUEST = new Uint8Array([CMD_FLASH_STATUS, 0x9f, 0x03]);
/** Each address-prefixed block's payload: 4 address bytes and the data. */
const BLOCK_PAYLOAD = 4 + XMODEM_BLOCK_SIZE;

/** A reply, as ltchiptool waits for one. */
const REPLY_MS = 600;
/** A loader waiting for block data ignores shorter bursts than five CANs, and needs this long after. */
const ABORT_SETTLE_MS = 300;
const ERASE_MS_PER_SECTOR = 200;
/** The loader reads the whole range from the flash before it answers. */
const CHECKSUM_MS_PER_MIB = 2500;
const CHECKSUM_MIN_MS = 2000;
const XMODEM_START_MS = 3000;
const XMODEM_REPLY_MS = 3000;
const XMODEM_RETRIES = 16;

export class AmbdProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbdProtocolError";
  }
}

/** What the loader's checksum command computes: the 32-bit sum of little-endian words, the tail bytes shifted in. */
export function checksum32(data: Uint8Array): number {
  let sum = 0;
  const words = data.length - (data.length % 4);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < words; i += 4) sum = (sum + view.getUint32(i, true)) >>> 0;
  for (let i = words; i < data.length; i++) {
    sum = (sum + data[i] * 2 ** ((i - words) * 8)) >>> 0;
  }
  return sum;
}

const int24LE = (v: number): number[] => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];

export class AmbdLink extends SerialByteSession implements XmodemIo {
  async write(data: Uint8Array): Promise<void> {
    await this.writeBytes(data);
  }

  /** Five CANs end a transfer a previous run left half way; the loader ignores shorter bursts. */
  async abortTransfer(): Promise<void> {
    this.drain();
    await this.write(new Uint8Array([CAN, CAN, CAN, CAN, CAN]));
    await sleep(ABORT_SETTLE_MS);
    this.drain();
  }

  /**
   * The next ``expected`` byte within ``timeoutMs``. Both the ROM and the
   * loader stream NAKs while they idle (an XModem receiver asking for its
   * first block), so the scan goes past those and any noise.
   */
  private async expectByte(expected: number, doc: string, timeoutMs = REPLY_MS) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const left = deadline - Date.now();
      const byte = left > 0 ? await this.readByte(left) : null;
      if (byte === expected) return;
      if (byte === null) throw new AmbdProtocolError(`No reply to ${doc}`);
    }
  }

  /**
   * The word at ``address``, or null when nothing answered as the ROM or
   * the loader would: the probe for a chip in download mode.
   */
  async readWord(address: number): Promise<Uint8Array | null> {
    this.drain();
    await this.write(new Uint8Array([CMD_READ_WORD, ...int32LE(address)]));
    try {
      await this.expectByte(CMD_READ_WORD, "the register read");
      // The word, then the NAK the ROM ends every reply with.
      const reply = await this.readBytes(5, REPLY_MS);
      return reply[4] === NAK ? reply.subarray(0, 4) : null;
    } catch {
      return null;
    }
  }

  /** The flash's JEDEC id (manufacturer, type, log2 size); it also proves the loader runs. */
  async flashId(): Promise<Uint8Array> {
    this.drain();
    await this.write(FLASH_ID_REQUEST);
    await this.expectByte(CMD_FLASH_STATUS, "the flash id read");
    return this.readBytes(3, REPLY_MS);
  }

  /** Erase ``sectors`` 4 KiB sectors from ``offset`` (sector aligned). */
  async erase(offset: number, sectors: number): Promise<void> {
    this.drain();
    await this.write(
      new Uint8Array([CMD_ERASE, ...int24LE(offset), sectors & 0xff, sectors >> 8])
    );
    await this.expectByte(
      ACK,
      `the erase at 0x${offset.toString(16)}`,
      Math.max(REPLY_MS, sectors * ERASE_MS_PER_SECTOR)
    );
  }

  /** The loader's checksum (``checksum32``) of ``length`` bytes of flash from ``offset``. */
  async checksum(offset: number, length: number): Promise<number> {
    this.drain();
    await this.write(
      new Uint8Array([CMD_CHECKSUM, ...int24LE(offset), ...int24LE(length)])
    );
    await this.expectByte(
      CMD_CHECKSUM,
      "the checksum",
      Math.max(CHECKSUM_MIN_MS, Math.ceil((length / 2 ** 20) * CHECKSUM_MS_PER_MIB))
    );
    const reply = await this.readBytes(4, REPLY_MS);
    return new DataView(reply.buffer, reply.byteOffset, 4).getUint32(0, true);
  }

  /** XModem-1k with the address in each block, to RAM (the ROM) or through the XIP window (the loader). */
  async memoryWrite(
    address: number,
    data: Uint8Array,
    { onBlock }: { onBlock?: (sent: number) => void } = {}
  ): Promise<void> {
    this.drain();
    await this.write(new Uint8Array([CMD_XMODEM]));
    await this.expectByte(ACK, "the XModem handshake");
    // The ROM and the loader ask with NAK (8-bit sums); a quiet one is taken the same way.
    const crc = await awaitStart(this, 0, XMODEM_START_MS).catch((err: unknown) => {
      if (!(err instanceof XmodemNoStartError)) throw err;
      return false;
    });
    let seq = 1;
    for (let off = 0; off < data.length; off += XMODEM_BLOCK_SIZE) {
      const chunk = data.subarray(off, Math.min(off + XMODEM_BLOCK_SIZE, data.length));
      const payload = new Uint8Array(BLOCK_PAYLOAD).fill(0xff);
      payload.set(int32LE(address + off), 0);
      payload.set(chunk, 4);
      const frame = buildBlock(seq, payload, crc, BLOCK_PAYLOAD, 0xff);
      await sendFrame(this, frame, `block ${seq}`, XMODEM_RETRIES, XMODEM_REPLY_MS);
      seq = (seq + 1) & 0xff;
      onBlock?.(off + chunk.length);
    }
    await sendFrame(
      this,
      EOT_FRAME,
      "the end of the file",
      XMODEM_RETRIES,
      XMODEM_REPLY_MS
    );
  }
}
