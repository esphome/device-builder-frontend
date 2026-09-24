/**
 * PICOBOOT client over WebUSB: the protocol picotool speaks to an RP2 in
 * BOOTSEL mode (pico-sdk ``boot/picoboot.h``). Loaded on demand by the
 * install flows; nothing here touches the DOM.
 */
import type { Uf2Image } from "./uf2.js";
import { isUsbDeviceLost } from "./web-usb.js";

export const PICOBOOT_MAGIC = 0x431fd10b;
export const PicobootCmd = {
  EXCLUSIVE_ACCESS: 0x01,
  REBOOT: 0x02,
  FLASH_ERASE: 0x03,
  WRITE: 0x05,
  EXIT_XIP: 0x06,
  ENTER_CMD_XIP: 0x07,
  // RP2350 boots through REBOOT2 (0x0a: dFlags, dDelayMS, dParam0, dParam1);
  // wire it here when an RP2350 is available to test against.
} as const;
const PICOBOOT_IF_RESET = 0x41;
const PICOBOOT_IF_CMD_STATUS = 0x42;
const PICOBOOT_STATUS_NAMES: Record<number, string> = {
  0: "OK",
  1: "UNKNOWN_CMD",
  2: "INVALID_CMD_LENGTH",
  3: "INVALID_TRANSFER_LENGTH",
  4: "INVALID_ADDRESS",
  5: "BAD_ALIGNMENT",
  6: "INTERLEAVED_WRITE",
  7: "REBOOTING",
  8: "UNKNOWN_ERROR",
  9: "INVALID_STATE",
  10: "NOT_PERMITTED",
  11: "INVALID_ARG",
  12: "BUFFER_TOO_SMALL",
  13: "PRECONDITION_NOT_MET",
  14: "MODIFIED_DATA",
  15: "INVALID_DATA",
  16: "NOT_FOUND",
  17: "UNSUPPORTED_MODIFICATION",
};

export const FLASH_XIP_BASE = 0x10000000;
const FLASH_XIP_SIZE = 16 * 1024 * 1024;
export const FLASH_SECTOR_SIZE = 4096;
export const FLASH_PAGE_SIZE = 256;
export const REBOOT_DELAY_MS = 500;
const EXCLUSIVE = 1;
const NOT_EXCLUSIVE = 0;
const ACK_READ_LENGTH = 64; // WebUSB rejects a zero length; the ACK is a zero-length packet.

export interface PicobootCommand {
  id: number;
  args?: Uint8Array;
  transferLength?: number;
}

/** 32-byte little-endian ``struct picoboot_cmd``. */
export function buildCommandPacket(
  token: number,
  cmd: PicobootCommand
): Uint8Array<ArrayBuffer> {
  const args = cmd.args ?? new Uint8Array(0);
  if (args.length > 16) throw new RangeError("PICOBOOT args exceed 16 bytes");
  const pkt = new Uint8Array(32);
  const view = new DataView(pkt.buffer);
  view.setUint32(0, PICOBOOT_MAGIC, true);
  view.setUint32(4, token >>> 0, true);
  pkt[8] = cmd.id;
  pkt[9] = args.length;
  view.setUint32(12, cmd.transferLength ?? 0, true);
  pkt.set(args, 16);
  return pkt;
}

// WebUSB wants an ArrayBuffer-backed view; a subarray of the image may not be.
function usbBuffer(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy;
}

function u32Args(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const view = new DataView(out.buffer);
  values.forEach((v, i) => view.setUint32(i * 4, v >>> 0, true));
  return out;
}

/** The bootloader rejected a command; ``statusCode`` is its ``picoboot_status``. */
export class PicobootError extends Error {
  constructor(
    readonly cmdId: number,
    readonly statusCode: number
  ) {
    super(
      `PICOBOOT command 0x${cmdId.toString(16)} failed: ${
        PICOBOOT_STATUS_NAMES[statusCode] ?? `status ${statusCode}`
      }`
    );
    this.name = "PicobootError";
  }
}

interface PicobootEndpoints {
  iface: number;
  epOut: number;
  epIn: number;
}

// The vendor interface (class 0xff / 0 / 0) sits beside the mass-storage one;
// take its bulk endpoints by descriptor rather than assuming their numbers.
function findPicobootInterface(device: USBDevice): PicobootEndpoints | null {
  for (const iface of device.configuration?.interfaces ?? []) {
    const alt = iface.alternates[0];
    if (
      !alt ||
      alt.interfaceClass !== 0xff ||
      alt.interfaceSubclass !== 0 ||
      alt.interfaceProtocol !== 0
    ) {
      continue;
    }
    const out = alt.endpoints.find((e) => e.type === "bulk" && e.direction === "out");
    const inp = alt.endpoints.find((e) => e.type === "bulk" && e.direction === "in");
    if (out && inp) {
      return {
        iface: iface.interfaceNumber,
        epOut: out.endpointNumber,
        epIn: inp.endpointNumber,
      };
    }
  }
  return null;
}

export class PicobootDevice {
  private token = 0;

  private constructor(
    readonly device: USBDevice,
    private readonly ep: PicobootEndpoints
  ) {}

  static async open(device: USBDevice): Promise<PicobootDevice> {
    await device.open();
    try {
      if (device.configuration === null) await device.selectConfiguration(1);
      const ep = findPicobootInterface(device);
      if (!ep) throw new Error("No PICOBOOT interface on this device");
      await device.claimInterface(ep.iface);
      const dev = new PicobootDevice(device, ep);
      await dev.resetInterface();
      return dev;
    } catch (err) {
      await device.close().catch(() => {});
      throw err;
    }
  }

  // picotool's connect-time reset: clear both endpoints and reset the interface.
  private async resetInterface(): Promise<void> {
    await this.device.clearHalt("in", this.ep.epIn);
    await this.device.clearHalt("out", this.ep.epOut);
    await this.device.controlTransferOut({
      requestType: "vendor",
      recipient: "interface",
      request: PICOBOOT_IF_RESET,
      value: 0,
      index: this.ep.iface,
    });
  }

  private async command(cmd: PicobootCommand, payload?: Uint8Array): Promise<void> {
    const token = ++this.token;
    const sent = await this.device.transferOut(
      this.ep.epOut,
      buildCommandPacket(token, cmd)
    );
    if (sent.status !== "ok") return this.fail(cmd.id);
    if (payload) {
      const data = await this.device.transferOut(this.ep.epOut, usbBuffer(payload));
      if (data.status !== "ok") return this.fail(cmd.id);
    }
    const ack = await this.device.transferIn(this.ep.epIn, ACK_READ_LENGTH);
    if (ack.status !== "ok") return this.fail(cmd.id);
  }

  // A rejected command stalls the endpoint. Recover picotool's way: clear the
  // halt, reset the interface, then read the status the bootloader recorded.
  private async fail(cmdId: number): Promise<never> {
    let statusCode = -1;
    let statusCmd = cmdId;
    try {
      await this.resetInterface();
      const res = await this.device.controlTransferIn(
        {
          requestType: "vendor",
          recipient: "interface",
          request: PICOBOOT_IF_CMD_STATUS,
          value: 0,
          index: this.ep.iface,
        },
        16
      );
      if (res.status === "ok" && res.data && res.data.byteLength >= 9) {
        statusCode = res.data.getUint32(4, true);
        statusCmd = res.data.getUint8(8);
      }
    } catch {
      // Recovery itself failed (device gone); report the original command.
    }
    throw new PicobootError(statusCmd, statusCode);
  }

  exclusiveAccess(mode: number): Promise<void> {
    return this.command({
      id: PicobootCmd.EXCLUSIVE_ACCESS,
      args: new Uint8Array([mode]),
    });
  }

  exitXip(): Promise<void> {
    return this.command({ id: PicobootCmd.EXIT_XIP });
  }

  flashErase(addr: number, size: number): Promise<void> {
    if (addr % FLASH_SECTOR_SIZE !== 0 || size % FLASH_SECTOR_SIZE !== 0) {
      throw new RangeError("Flash erase must be 4 KiB aligned");
    }
    return this.command({ id: PicobootCmd.FLASH_ERASE, args: u32Args(addr, size) });
  }

  write(addr: number, data: Uint8Array): Promise<void> {
    if (addr % FLASH_PAGE_SIZE !== 0 || data.length % FLASH_PAGE_SIZE !== 0) {
      throw new RangeError("Flash write must be 256-byte aligned");
    }
    return this.command(
      {
        id: PicobootCmd.WRITE,
        args: u32Args(addr, data.length),
        transferLength: data.length,
      },
      data
    );
  }

  /** RP2040 reboot into flash. The device may drop off the bus before the ACK arrives. */
  async reboot(pc = 0, sp = 0, delayMs = REBOOT_DELAY_MS): Promise<void> {
    try {
      await this.command({ id: PicobootCmd.REBOOT, args: u32Args(pc, sp, delayMs) });
    } catch (err) {
      if (!isUsbDeviceLost(err)) throw err;
    }
  }

  async close(): Promise<void> {
    await this.device.releaseInterface(this.ep.iface).catch(() => {});
    await this.device.close().catch(() => {});
  }
}

interface SectorWrite {
  address: number;
  data: Uint8Array;
}

// Group every page of every range by the 4 KiB sector it lands in, so each
// sector is erased exactly once before any of its pages are written. Two
// ranges sharing a sector would otherwise erase each other's pages.
function planSectors(image: Uf2Image): Map<number, SectorWrite[]> {
  const sectors = new Map<number, SectorWrite[]>();
  for (const range of image.ranges) {
    if (
      range.address < FLASH_XIP_BASE ||
      range.address + range.data.length > FLASH_XIP_BASE + FLASH_XIP_SIZE
    ) {
      throw new Error(
        "UF2 targets memory outside flash; only flash images can be written"
      );
    }
    for (let off = 0; off < range.data.length;) {
      const addr = range.address + off;
      const sector = addr - (addr % FLASH_SECTOR_SIZE);
      const len = Math.min(sector + FLASH_SECTOR_SIZE - addr, range.data.length - off);
      const list = sectors.get(sector) ?? [];
      list.push({ address: addr, data: range.data.subarray(off, off + len) });
      sectors.set(sector, list);
      off += len;
    }
  }
  return new Map([...sectors.entries()].sort((a, b) => a[0] - b[0]));
}

export interface FlashUf2Options {
  signal?: AbortSignal;
}

/**
 * picotool's ``load`` sequence: take exclusive access, leave XIP, then erase
 * and write sector by sector, and reboot into the new firmware. The abort
 * signal is checked between sectors; the device stays in BOOTSEL after an
 * abort or failure, so the caller can retry without a reset.
 */
export async function flashUf2(
  dev: PicobootDevice,
  image: Uf2Image,
  onProgress: (percent: number) => void,
  options: FlashUf2Options = {}
): Promise<void> {
  const { signal } = options;
  const sectors = planSectors(image);
  let written = 0;
  let rebooted = false;
  try {
    await dev.exclusiveAccess(EXCLUSIVE);
    await dev.exitXip();
    for (const [sector, writes] of sectors) {
      signal?.throwIfAborted();
      await dev.flashErase(sector, FLASH_SECTOR_SIZE);
      for (const w of writes) {
        await dev.write(w.address, w.data);
        written += w.data.length;
        onProgress(Math.floor((written / image.totalBytes) * 99));
      }
    }
    signal?.throwIfAborted();
    await dev.reboot();
    rebooted = true;
    onProgress(100);
  } finally {
    if (!rebooted) await dev.exclusiveAccess(NOT_EXCLUSIVE).catch(() => {});
    await dev.close();
  }
}
