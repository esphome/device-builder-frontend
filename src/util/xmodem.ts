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
const SOH = 0x01;
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

/** The receiver stayed silent; the one start failure a sender may choose to go past. */
export class XmodemNoStartError extends XmodemError {
  constructor() {
    super("Receiver never asked for the first block");
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

/** Wait for the receiver's opening byte; true for CRC-16 ('C'), false for checksum (NAK). */
export async function awaitStart(
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
  throw new XmodemNoStartError();
}

/**
 * One block: SOH for 128 bytes, STX for anything bigger (1k, or a ROM's 1k
 * that carries more), the payload padded with ``pad`` (YMODEM pads its
 * header block with zeros), then the check.
 */
export function buildBlock(
  seq: number,
  payload: Uint8Array,
  crcMode: boolean,
  size = XMODEM_BLOCK_SIZE,
  pad = PAD
): Uint8Array {
  const block = new Uint8Array(3 + size + (crcMode ? 2 : 1));
  block[0] = size > 128 ? STX : SOH;
  block[1] = seq;
  block[2] = 0xff - seq;
  block.fill(pad, 3, 3 + size);
  block.set(payload, 3);
  const data = block.subarray(3, 3 + size);
  if (crcMode) {
    const crc = crc16Xmodem(data);
    block[3 + size] = crc >> 8;
    block[4 + size] = crc & 0xff;
  } else {
    block[3 + size] = data.reduce((sum, b) => (sum + b) & 0xff, 0);
  }
  return block;
}

/**
 * The receiver's reply to a block: ACK, NAK or CAN, or null when none came
 * in time. Anything else (the 'C' a receiver repeats while it waits, line
 * noise) is skipped, as the reference senders do.
 */
async function awaitReply(io: XmodemIo, timeoutMs: number): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const left = deadline - Date.now();
    if (left <= 0) return null;
    const byte = await io.readByte(left);
    if (byte === null || byte === ACK || byte === NAK || byte === CAN) return byte;
  }
}

/** Write ``frame`` until the receiver ACKs it; ``label`` names it in the errors. */
export async function sendFrame(
  io: XmodemIo,
  frame: Uint8Array,
  label: string,
  retries: number,
  timeoutMs: number
): Promise<void> {
  for (let errors = 0; ; errors++) {
    await io.write(frame);
    const reply = await awaitReply(io, timeoutMs);
    if (reply === ACK) return;
    if (reply === CAN) throw new XmodemError(`Receiver cancelled at ${label}`);
    if (errors >= retries) {
      throw new XmodemError(
        `${label} was not acknowledged after ${retries} ${retries === 1 ? "retry" : "retries"}`
      );
    }
  }
}

/** The end of a file, sent until ACKed (a receiver may NAK the first). */
export const EOT_FRAME = new Uint8Array([EOT]);

export async function xmodemSend(
  io: XmodemIo,
  data: Uint8Array,
  { retries = 16, timeoutMs = 3000, onBlock }: XmodemOptions = {}
): Promise<void> {
  const crcMode = await awaitStart(io, retries, timeoutMs);
  let seq = 1;
  for (let off = 0; off < data.length; off += XMODEM_BLOCK_SIZE) {
    const payload = data.subarray(off, Math.min(off + XMODEM_BLOCK_SIZE, data.length));
    await sendFrame(
      io,
      buildBlock(seq, payload, crcMode),
      `block ${seq}`,
      retries,
      timeoutMs
    );
    seq = (seq + 1) & 0xff;
    onBlock?.(off + payload.length);
  }
  await sendFrame(io, EOT_FRAME, "the end of the file", retries, timeoutMs);
}
