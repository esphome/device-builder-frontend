/**
 * YMODEM batch sender for one file, as the ymodem package drives it for
 * ltchiptool: 128-byte SOH blocks, a header block naming the file and its
 * length, EOT, then the empty header that ends the batch. Built on the
 * XModem blocks; the receiver's 'C' picks CRC-16 and NAK the plain checksum.
 */
import { awaitStart, buildBlock, EOT_FRAME, sendFrame, type XmodemIo } from "./xmodem.js";

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
  await sendFrame(
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
    await sendFrame(
      io,
      buildBlock(seq, payload, crcMode, YMODEM_BLOCK_SIZE),
      `block ${seq}`,
      retries,
      timeoutMs
    );
    seq = (seq + 1) & 0xff;
    onBlock?.(off + payload.length);
  }
  await sendFrame(io, EOT_FRAME, "the end of the file", retries, timeoutMs);
  // The empty header ends the batch; the reference sender does not wait
  // for its ACK, and whatever follows drains it.
  await io.write(buildBlock(0, new Uint8Array(0), crcMode, YMODEM_BLOCK_SIZE, 0));
}
