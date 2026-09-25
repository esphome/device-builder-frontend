/**
 * XModem-1k sender: 1024-byte STX blocks, the receiver's opening byte picking
 * plain checksum (NAK) or CRC-16 ('C'), retries per block, EOT to finish. The
 * same handshake python-xmodem drives for ltchiptool, so a ROM that accepts
 * one accepts the other.
 */
export interface XmodemIo {
  write(data: Uint8Array): Promise<void>;
  /** The next byte, or null when none arrived within the timeout. */
  readByte(timeoutMs: number): Promise<number | null>;
}

export interface XmodemOptions {
  retries?: number;
  timeoutMs?: number;
  /** After each acknowledged block: payload bytes sent so far. */
  onBlock?: (sent: number) => void;
}

export const XMODEM_BLOCK_SIZE = 1024;
const STX = 0x02;
const EOT = 0x04;
const ACK = 0x06;
const NAK = 0x15;
const CAN = 0x18;
const CRC_REQUEST = 0x43;
const PAD = 0x1a;

export class XmodemError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmodemError";
  }
}

/** CRC-16/XMODEM: polynomial 0x1021, initial value 0. */
export function crc16Xmodem(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

async function awaitStart(
  io: XmodemIo,
  retries: number,
  timeoutMs: number
): Promise<boolean> {
  let cancels = 0;
  for (let errors = 0; errors <= retries; errors++) {
    const byte = await io.readByte(timeoutMs);
    if (byte === NAK) return false;
    if (byte === CRC_REQUEST) return true;
    if (byte === EOT)
      throw new XmodemError("Receiver ended the transfer before it began");
    if (byte === CAN && ++cancels >= 2)
      throw new XmodemError("Receiver cancelled the transfer");
  }
  throw new XmodemError("Receiver never asked for the first block");
}

function buildBlock(seq: number, payload: Uint8Array, crcMode: boolean): Uint8Array {
  const block = new Uint8Array(3 + XMODEM_BLOCK_SIZE + (crcMode ? 2 : 1));
  block[0] = STX;
  block[1] = seq;
  block[2] = 0xff - seq;
  block.fill(PAD, 3, 3 + XMODEM_BLOCK_SIZE);
  block.set(payload, 3);
  const data = block.subarray(3, 3 + XMODEM_BLOCK_SIZE);
  if (crcMode) {
    const crc = crc16Xmodem(data);
    block[3 + XMODEM_BLOCK_SIZE] = crc >> 8;
    block[4 + XMODEM_BLOCK_SIZE] = crc & 0xff;
  } else {
    block[3 + XMODEM_BLOCK_SIZE] = data.reduce((sum, b) => (sum + b) & 0xff, 0);
  }
  return block;
}

export async function xmodemSend(
  io: XmodemIo,
  data: Uint8Array,
  { retries = 16, timeoutMs = 3000, onBlock }: XmodemOptions = {}
): Promise<void> {
  const crcMode = await awaitStart(io, retries, timeoutMs);
  let seq = 1;
  for (let off = 0; off < data.length; off += XMODEM_BLOCK_SIZE) {
    const payload = data.subarray(off, Math.min(off + XMODEM_BLOCK_SIZE, data.length));
    const block = buildBlock(seq, payload, crcMode);
    let acked = false;
    for (let errors = 0; !acked; errors++) {
      await io.write(block);
      const reply = await io.readByte(timeoutMs);
      if (reply === ACK) {
        acked = true;
      } else if (reply === CAN) {
        throw new XmodemError(`Receiver cancelled at block ${seq}`);
      } else if (errors >= retries) {
        throw new XmodemError(
          `Block ${seq} was not acknowledged after ${retries} retries`
        );
      }
    }
    seq = (seq + 1) & 0xff;
    onBlock?.(off + payload.length);
  }
  for (let errors = 0; ; errors++) {
    await io.write(new Uint8Array([EOT]));
    if ((await io.readByte(timeoutMs)) === ACK) return;
    if (errors >= retries) throw new XmodemError("End of transfer was not acknowledged");
  }
}
