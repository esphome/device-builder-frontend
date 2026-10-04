/**
 * YMODEM batch sender for one file, as the ymodem package drives it for
 * ltchiptool: 128-byte SOH blocks, a header block naming the file and its
 * length, EOT, then the empty header that ends the batch. Built on the
 * XModem blocks; the receiver's 'C' picks CRC-16 and NAK the plain checksum.
 */
import { awaitStart, buildBlock, XmodemError, type XmodemIo } from "./xmodem.js";

export interface YmodemOptions {
  retries?: number;
  /** How long a data block or EOT waits for its reply. */
  timeoutMs?: number;
  /**
   * How long the header waits for its ACK. A receiver writing to flash
   * erases the whole file's room before it answers.
   */
  headerTimeoutMs?: number;
  /** After each acknowledged data block: payload bytes sent so far. */
  onBlock?: (sent: number) => void;
}

export const YMODEM_BLOCK_SIZE = 128;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const CAN = 0x18;

/**
 * The receiver's reply to a block: ACK, NAK or CAN, or null when none came
 * in time. Anything else (the 'C' a receiver repeats while it waits) is
 * skipped, as the reference sender does.
 */
async function awaitReply(io: XmodemIo, timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return null;
    const byte = await io.readByte(left);
    if (byte === null) return null;
    if (byte === ACK || byte === NAK || byte === CAN) return byte;
  }
}

async function sendBlock(
  io: XmodemIo,
  block: Uint8Array,
  label: string,
  retries: number,
  timeoutMs: number
): Promise<void> {
  for (let errors = 0; ; errors++) {
    await io.write(block);
    const reply = await awaitReply(io, timeoutMs);
    if (reply === ACK) return;
    if (reply === CAN) throw new XmodemError(`Receiver cancelled at ${label}`);
    if (errors >= retries) {
      throw new XmodemError(`${label} was not acknowledged after ${retries} retries`);
    }
  }
}

/** Block 0: the name, a NUL, then the length, the mtime (0, unknown) and the serial number. */
function headerPayload(name: string, length: number): Uint8Array {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const fields = encoder.encode(`${length} 0 0`);
  const payload = new Uint8Array(nameBytes.length + 1 + fields.length);
  payload.set(nameBytes);
  payload.set(fields, nameBytes.length + 1);
  return payload;
}

export async function ymodemSend(
  io: XmodemIo,
  name: string,
  data: Uint8Array,
  { retries = 10, timeoutMs = 3000, headerTimeoutMs = 30000, onBlock }: YmodemOptions = {}
): Promise<void> {
  const crcMode = await awaitStart(io, retries, timeoutMs);
  const header = headerPayload(name, data.length);
  await sendBlock(
    io,
    buildBlock(0, header, crcMode, YMODEM_BLOCK_SIZE, 0),
    "the header block",
    retries,
    headerTimeoutMs
  );
  // The receiver asks again for the data.
  await awaitStart(io, retries, timeoutMs);
  let seq = 1;
  for (let off = 0; off < data.length; off += YMODEM_BLOCK_SIZE) {
    const payload = data.subarray(off, Math.min(off + YMODEM_BLOCK_SIZE, data.length));
    await sendBlock(
      io,
      buildBlock(seq, payload, crcMode, YMODEM_BLOCK_SIZE),
      `block ${seq}`,
      retries,
      timeoutMs
    );
    seq = (seq + 1) & 0xff;
    onBlock?.(off + payload.length);
  }
  // A receiver may NAK the first EOT to have it sent again.
  for (let errors = 0; ; errors++) {
    await io.write(new Uint8Array([EOT]));
    const reply = await awaitReply(io, timeoutMs);
    if (reply === ACK) break;
    if (reply === CAN) throw new XmodemError("Receiver cancelled at the end of the file");
    if (errors >= retries) {
      throw new XmodemError("End of transfer was not acknowledged");
    }
  }
  // The empty header ends the batch; the reference sender does not wait
  // for its ACK, and whatever follows drains it.
  await io.write(buildBlock(0, new Uint8Array(0), crcMode, YMODEM_BLOCK_SIZE, 0));
}
