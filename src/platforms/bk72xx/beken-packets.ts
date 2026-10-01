/**
 * The packets of the Beken UART download protocol, as bk7231tools frames
 * them. A command is ``01 E0 FC <len> <code> <payload>``; one whose length
 * does not fit a byte, or that is a long one by its nature, is
 * ``01 E0 FC FF F4 <len:u16> <code> <payload>``. The length counts the code.
 * Two pairs of commands share a code and differ only in the form.
 */
import { concat, int32LE } from "../../util/bytes.js";

export const COMMAND_PREAMBLE = [0x01, 0xe0, 0xfc] as const;
export const RESPONSE_PREAMBLE = [0x04, 0x0e] as const;
export const LONG_MARK = 0xf4;
export const SECTOR_SIZE = 0x1000;
/** What one FlashWrite takes at most. */
export const PAGE_SIZE = 0x100;
const ERASE_SECTOR_4K = 0x20;
/** The flash's own commands, passed through by the status register packets. */
const FLASH_READ_SR_LOW = 0x05;
const FLASH_READ_SR_HIGH = 0x35;
const FLASH_WRITE_SR = 0x01;
const FLASH_READ_ID = 0x9f;

export interface BekenCommand {
  name: string;
  code: number;
  long: boolean;
  payload: Uint8Array;
  /** The code of the response; absent when the chip sends none. */
  reply?: number;
  /** The response carries the start of the payload back, from this offset. */
  echo?: { at: number; length: number };
  /** Offsets in the response that hold a status, which must be 0. */
  status?: readonly number[];
  /** The bytes the response has at least; one with fewer is not read. */
  least?: number;
}

export function encodeCommand({ code, long, payload }: BekenCommand): Uint8Array {
  const size = payload.length + 1;
  const head =
    size >= 0xff || long
      ? [...COMMAND_PREAMBLE, 0xff, LONG_MARK, size & 0xff, size >> 8, code]
      : [...COMMAND_PREAMBLE, size, code];
  return concat(new Uint8Array(head), payload);
}

const u32 = (value: number) => int32LE(value >>> 0);
const NONE = new Uint8Array(0);

export const linkCheck = (): BekenCommand => ({
  name: "LinkCheck",
  code: 0x00,
  long: false,
  payload: NONE,
  // The one command that is answered under another code.
  reply: 0x01,
  least: 1,
});

export const readRegister = (address: number): BekenCommand => ({
  name: "ReadReg",
  code: 0x03,
  long: false,
  payload: u32(address),
  reply: 0x03,
  echo: { at: 0, length: 4 },
  least: 8,
});

export const reboot = (): BekenCommand => ({
  name: "Reboot",
  code: 0x0e,
  long: false,
  payload: new Uint8Array([0xa5]),
});

export const checkCrc = (start: number, end: number): BekenCommand => ({
  name: "CheckCRC",
  code: 0x10,
  long: false,
  payload: concat(u32(start), u32(end)),
  reply: 0x10,
  least: 4,
});

export const readBootVersion = (): BekenCommand => ({
  name: "ReadBootVersion",
  code: 0x11,
  long: false,
  payload: NONE,
  reply: 0x11,
});

export const flashWrite = (start: number, data: Uint8Array): BekenCommand => ({
  name: "FlashWrite",
  code: 0x06,
  long: true,
  payload: concat(u32(start), data),
  reply: 0x06,
  echo: { at: 1, length: 4 },
  status: [0],
  least: 6,
});

export const flashWrite4k = (start: number, data: Uint8Array): BekenCommand => ({
  name: "FlashWrite4K",
  code: 0x07,
  long: true,
  payload: concat(u32(start), data),
  reply: 0x07,
  echo: { at: 1, length: 4 },
  status: [0],
  least: 5,
});

export const flashRead4k = (start: number): BekenCommand => ({
  name: "FlashRead4K",
  code: 0x09,
  long: true,
  payload: u32(start),
  reply: 0x09,
  echo: { at: 1, length: 4 },
  status: [0],
  least: 5,
});

const flashReadRegister = (command: number): BekenCommand => ({
  name: "FlashReadSR",
  code: 0x0c,
  long: true,
  payload: new Uint8Array([command]),
  reply: 0x0c,
  echo: { at: 1, length: 1 },
  status: [0],
  least: 3,
});

export const flashReadSrLow = () => flashReadRegister(FLASH_READ_SR_LOW);
export const flashReadSrHigh = () => flashReadRegister(FLASH_READ_SR_HIGH);

/** One byte or two, as the flash's status register is wide. */
export const flashWriteSr = (value: number, size: 1 | 2): BekenCommand => ({
  name: "FlashWriteSR",
  code: 0x0d,
  long: true,
  payload:
    size === 1
      ? new Uint8Array([FLASH_WRITE_SR, value & 0xff])
      : new Uint8Array([FLASH_WRITE_SR, value & 0xff, (value >> 8) & 0xff]),
  reply: 0x0d,
  echo: { at: 1, length: size + 1 },
  status: [0],
  least: 3,
});

export const flashGetId = (): BekenCommand => ({
  name: "FlashGetMID",
  code: 0x0e,
  long: true,
  payload: u32(FLASH_READ_ID),
  reply: 0x0e,
  status: [0],
  least: 5,
});

/** ``checked``: the BootROM's status byte is looked at; a bootloader's is not known. */
export const flashEraseSector = (start: number, checked = false): BekenCommand => ({
  name: "FlashErase",
  code: 0x0f,
  long: true,
  payload: concat(new Uint8Array([ERASE_SECTOR_4K]), u32(start)),
  reply: 0x0f,
  echo: { at: 1, length: 5 },
  ...(checked && { status: [0] }),
  least: 6,
});

export const readU32 = (bytes: Uint8Array, at: number): number =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true);
