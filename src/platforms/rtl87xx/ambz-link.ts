/**
 * The Realtek AmebaZ (RTL8710B) ROM downloader's byte protocol, as
 * ltchiptool's AmbZTool speaks it: a "loud" handshake that NAKs on its own,
 * a "quiet" one for flash reads, a baud rate table, FLASH_READ in acknowledged
 * 1 KiB pieces, and memory writes over XModem-1k whose blocks carry their
 * target address in front of the data.
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

export const AMBZ_ROM_BAUD = 1500000;
export const AMBZ_FLASH_ADDRESS = 0x08000000;
export const AMBZ_RAM_ADDRESS = 0x10002000;
/** The ROM's ``SET_BAUD_RATE`` takes an index into this table. */
const BAUD_TABLE = [
  110, 300, 600, 1200, 2400, 4800, 9600, 14400, 19200, 28800, 38400, 57600, 76800, 115200,
  128000, 153600, 230400, 380400, 460800, 500000, 921600, 1000000, 1382400, 1444400,
  1500000, 1843200, 2000000, 2100000, 2764800, 3000000, 3250000, 3692300, 3750000,
  4000000, 6000000,
];

const ACK = 0x06;
const NAK = 0x15;
const CMD_SET_BAUD_RATE = 0x05;
const CMD_XMODEM_HANDSHAKE = 0x07;
const CMD_FLASH_READ = 0x19;
const CMD_FLASH_GET_STATUS = 0x21;
const CMD_XMODEM_CAN = 0x18;
/** Back to the loud handshake from wherever the ROM is. */
const DISCONNECT = new Uint8Array([CMD_XMODEM_CAN, CMD_XMODEM_HANDSHAKE, CMD_XMODEM_CAN]);
const READ_BLOCK = 4096;
const READ_ACK_SIZE = 1024;
/** Each address-prefixed block's payload: 4 address bytes and the data. */
const BLOCK_PAYLOAD = 4 + XMODEM_BLOCK_SIZE;

/** A reply, waited on with the timeout restarting at every byte (as ltchiptool reads). */
const READ_MS = 500;
const QUIET_MS = 100;
/** How long the line must stay silent before the ROM is taken to have finished printing. */
const SETTLE_MS = 50;
const SETTLE_LIMIT_MS = 1000;
const QUIET_LIMIT_MS = 10000;
const LINK_LISTEN_MS = 250;
const LINK_RETRY_MS = 100;
/** How long the ROM gets to NAK for the first block; an RTL8710BX takes about a second. */
const XMODEM_START_MS = 3000;
const XMODEM_REPLY_MS = 3000;
const XMODEM_RETRIES = 16;

class AmbzProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbzProtocolError";
  }
}

function baudIndex(baud: number): number {
  const index = BAUD_TABLE.indexOf(baud);
  if (index < 0) throw new Error(`The AmebaZ ROM has no ${baud} baud rate`);
  return index;
}

export interface MemoryWriteOptions {
  /** After each acknowledged block: data bytes sent so far. */
  onBlock?: (sent: number) => void;
  /** A RAM write that boots the chip, which then never ACKs the end of the transfer. */
  boots?: boolean;
}

export class AmbzLink extends SerialByteSession implements XmodemIo {
  async write(data: Uint8Array): Promise<void> {
    await this.writeBytes(data);
  }

  /** ``skipNaks``: an idle loud handshake NAK can land ahead of the reply. */
  private async expectAck(doc: string, skipNaks = false): Promise<void> {
    let reply = await this.readByte(READ_MS);
    while (skipNaks && reply === NAK) reply = await this.readByte(READ_MS);
    if (reply !== ACK) {
      throw new AmbzProtocolError(
        `No ACK after ${doc} (got ${reply === null ? "nothing" : `0x${reply.toString(16)}`})`
      );
    }
  }

  /** Into the loud handshake, where the ROM NAKs by itself; the check ltchiptool runs. */
  async loudHandshake(): Promise<void> {
    this.drain();
    await this.write(new Uint8Array([CMD_FLASH_GET_STATUS]));
    // The flash status byte, then the NAKs the handshake goes on with.
    const reply = await this.readBytes(6, READ_MS);
    if (reply[5] !== NAK) {
      throw new AmbzProtocolError("The ROM did not NAK after the loud handshake");
    }
  }

  /** Wait until the ROM stops sending (its log, at another speed), then drop it. */
  async settle(): Promise<void> {
    const deadline = Date.now() + SETTLE_LIMIT_MS;
    while (Date.now() < deadline && (await this.readByte(SETTLE_MS)) !== null);
    this.drain();
  }

  /** ACK until the ROM falls quiet, so nothing it sends is taken for flash data. */
  async quietHandshake(): Promise<void> {
    this.drain();
    const deadline = Date.now() + QUIET_LIMIT_MS;
    while (Date.now() < deadline) {
      await this.write(new Uint8Array([ACK]));
      if ((await this.readByte(QUIET_MS)) === null) return;
      // ltchiptool discards up to 4 bytes per ACK: the one just read and these.
      this.buf.splice(0, 3);
    }
    throw new AmbzProtocolError("The ROM never went quiet");
  }

  /**
   * Listen for the ROM's loud-handshake NAKs, nudging it there between
   * listens, until ``timeoutMs`` passes; true once linked.
   */
  async link(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    // No drain: the NAKs may already be waiting, and only the last four count.
    let tail: number[] = [];
    do {
      tail = [...tail, ...(await this.readQuiet(LINK_LISTEN_MS, LINK_LISTEN_MS))].slice(
        -4
      );
      if (tail.length === 4 && tail.every((b) => b === NAK)) {
        await this.loudHandshake();
        return true;
      }
      await this.write(DISCONNECT);
      await sleep(LINK_RETRY_MS);
    } while (Date.now() < deadline);
    return false;
  }

  /** Ask the ROM for ``baud``; the caller reopens the port at it after the ACK. */
  async requestBaud(baud: number): Promise<void> {
    this.drain();
    await this.write(new Uint8Array([CMD_SET_BAUD_RATE, baudIndex(baud)]));
    await this.expectAck("the baud rate change", true);
  }

  /** Read ``blocks`` 4 KiB blocks of flash from ``offset`` (ROM FLASH_READ, no verify). */
  async flashRead(offset: number, blocks: number): Promise<Uint8Array> {
    await this.loudHandshake();
    await this.quietHandshake();
    // The offset in 3 bytes, the count of 4 KiB blocks in 2, both little endian.
    await this.write(
      new Uint8Array([
        CMD_FLASH_READ,
        ...int32LE(offset).subarray(0, 3),
        blocks & 0xff,
        blocks >> 8,
      ])
    );
    const out = new Uint8Array(blocks * READ_BLOCK);
    for (let at = 0; at < out.length; at += READ_ACK_SIZE) {
      out.set(await this.readBytes(READ_ACK_SIZE, READ_MS), at);
      await this.write(new Uint8Array([ACK]));
    }
    await this.write(new Uint8Array([ACK])); // back to the quiet handshake
    await this.loudHandshake();
    return out;
  }

  /**
   * Write ``data`` to ``address`` over XModem-1k, plain checksum. The ROM's
   * receiver NAKs once it is ready, which can be a second after the
   * handshake's ACK; a block sent before that is lost. ltchiptool sends at
   * once: the same bytes, here once the ROM asks (or after a while, if not).
   */
  async memoryWrite(
    address: number,
    data: Uint8Array,
    { onBlock, boots = false }: MemoryWriteOptions = {}
  ): Promise<void> {
    await this.loudHandshake();
    await this.write(new Uint8Array([CMD_XMODEM_HANDSHAKE]));
    await this.expectAck("the XModem handshake");
    await awaitStart(this, 0, XMODEM_START_MS).catch((err: unknown) => {
      if (!(err instanceof XmodemNoStartError)) throw err;
    });
    let seq = 1;
    for (let off = 0; off < data.length; off += XMODEM_BLOCK_SIZE) {
      const chunk = data.subarray(off, Math.min(off + XMODEM_BLOCK_SIZE, data.length));
      const payload = new Uint8Array(BLOCK_PAYLOAD).fill(0xff);
      payload.set(int32LE(address + off), 0);
      payload.set(chunk, 4);
      const frame = buildBlock(seq, payload, false, BLOCK_PAYLOAD, 0xff);
      await sendFrame(this, frame, `block ${seq}`, XMODEM_RETRIES, XMODEM_REPLY_MS);
      seq = (seq + 1) & 0xff;
      onBlock?.(off + chunk.length);
    }
    if (boots) await this.write(EOT_FRAME);
    else {
      await sendFrame(
        this,
        EOT_FRAME,
        "the end of the file",
        XMODEM_RETRIES,
        XMODEM_REPLY_MS
      );
    }
  }
}
