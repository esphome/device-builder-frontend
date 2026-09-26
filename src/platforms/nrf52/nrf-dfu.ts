import { unzipSync } from "fflate";

import { concat, int32LE } from "../../util/bytes.js";
import { tenthLogger } from "../../util/flash-log.js";
import {
  markSerialActivity,
  openLiveSerialPort,
  SERIAL_REOPEN_TIMEOUT_MS,
} from "../../util/serial-reacquire.js";
import { SerialStreamSession } from "../../util/serial-stream-session.js";
import { sleep } from "../../util/sleep.js";

export interface DfuFirmwarePart {
  type: "application" | "bootloader" | "softdevice" | "softdevice+bootloader";
  mode: number;
  bin: Uint8Array;
  dat: Uint8Array;
  sdSize?: number;
  blSize?: number;
}

export interface DfuPackage {
  parts: DfuFirmwarePart[];
}

/** 0-100 across every part of the package. */
export type DfuProgressCallback = (percent: number) => void;

export interface DfuFlashHooks {
  onProgress: DfuProgressCallback;
  /** One line per step, for the install dialog's details log. */
  onLog?: (line: string) => void;
  /** The device dropped mid-flash and the engine is waiting for it to come back. */
  onReconnecting?: () => void;
  /** Stops between packets and releases the port; the bootloader stays in DFU mode for a retry. */
  signal?: AbortSignal;
}

const DFU_MODE_SD = 1;
const DFU_MODE_BL = 2;
const DFU_MODE_APP = 4;
const DFU_MODE_SD_BL = 3;

interface ManifestEntry {
  bin_file: string;
  dat_file: string;
  info_read_only_metadata?: { sd_size?: number; bl_size?: number };
}

interface Manifest {
  softdevice_bootloader?: ManifestEntry;
  softdevice?: ManifestEntry;
  bootloader?: ManifestEntry;
  application?: ManifestEntry;
}

/** Parse a Nordic/Adafruit DFU package ZIP. */
export function parseDfuPackage(zipBytes: Uint8Array): DfuPackage {
  const files = unzipSync(zipBytes);

  const manifestRaw = files["manifest.json"];
  if (!manifestRaw) throw new Error("manifest.json not found in DFU package");

  const root = JSON.parse(new TextDecoder().decode(manifestRaw)) as {
    manifest?: Manifest;
  };
  const manifest = root.manifest;
  if (!manifest) throw new Error("Invalid manifest.json: missing manifest key");

  const order: Array<{
    key: keyof Manifest;
    type: DfuFirmwarePart["type"];
    mode: number;
  }> = [
    { key: "softdevice_bootloader", type: "softdevice+bootloader", mode: DFU_MODE_SD_BL },
    { key: "softdevice", type: "softdevice", mode: DFU_MODE_SD },
    { key: "bootloader", type: "bootloader", mode: DFU_MODE_BL },
    { key: "application", type: "application", mode: DFU_MODE_APP },
  ];

  const parts: DfuFirmwarePart[] = [];

  for (const { key, type, mode } of order) {
    const info = manifest[key];
    if (!info) continue;

    const bin = files[info.bin_file];
    if (!bin) throw new Error(`Binary file not found: ${info.bin_file}`);

    const dat = files[info.dat_file];
    if (!dat) throw new Error(`Init packet file not found: ${info.dat_file}`);

    const part: DfuFirmwarePart = { type, mode, bin, dat };

    if (type === "softdevice+bootloader") {
      part.sdSize = info.info_read_only_metadata?.sd_size;
      part.blSize = info.info_read_only_metadata?.bl_size;
    }

    parts.push(part);
  }

  if (parts.length === 0) throw new Error("No firmware found in DFU package");

  return { parts };
}

// ── SLIP framing ─────────────────────────────────────────────────────────────

const SLIP_END = 0xc0;
const SLIP_ESC = 0xdb;
const SLIP_ESC_END = 0xdc;
const SLIP_ESC_ESC = 0xdd;

export function slipEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (const b of data) {
    if (b === SLIP_END) {
      out.push(SLIP_ESC, SLIP_ESC_END);
    } else if (b === SLIP_ESC) {
      out.push(SLIP_ESC, SLIP_ESC_ESC);
    } else {
      out.push(b);
    }
  }
  return new Uint8Array(out);
}

export function slipDecode(data: Uint8Array): Uint8Array {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === SLIP_ESC) {
      i++;
      if (i >= data.length) throw new Error("Truncated SLIP escape sequence");
      result.push(data[i] === SLIP_ESC_END ? SLIP_END : SLIP_ESC);
    } else {
      result.push(data[i]);
    }
  }
  return new Uint8Array(result);
}

// ── CRC-16 (Nordic variant) ───────────────────────────────────────────────────

export function crc16Nordic(data: Uint8Array): number {
  let crc = 0xffff;
  for (const b of data) {
    crc = ((crc >> 8) & 0x00ff) | ((crc << 8) & 0xff00);
    crc ^= b;
    crc ^= (crc & 0x00ff) >> 4;
    crc ^= (crc << 8) << 4;
    crc ^= ((crc & 0x00ff) << 4) << 1;
  }
  return crc & 0xffff;
}

// ── Packet helpers ────────────────────────────────────────────────────────────

const HCI_PACKET_TYPE = 14;
const DATA_INTEGRITY_PRESENT = 1;
const RELIABLE_PACKET = 1;
const DFU_START_PACKET = 3;
const DFU_INIT_PACKET = 1;
const DFU_DATA_PACKET = 4;
const DFU_STOP_DATA_PACKET = 5;
const DFU_PACKET_MAX_SIZE = 512;
const ACK_TIMEOUT_MS = 1000;
const MAX_SEND_ATTEMPTS = 3;
// adafruit-nrfutil's FLASH_PAGE_WRITE_TIME / FLASH_PAGE_ERASE_TIME per 4 KiB page.
const PAGE_WRITE_MS = (4096 / 4) * 0.0001 * 1000;
const PAGE_ERASE_MS = 89.7;

export function buildHciPacket(data: Uint8Array, seq: number): Uint8Array {
  const h = new Uint8Array(4);
  h[0] =
    seq | (((seq + 1) % 8) << 3) | (DATA_INTEGRITY_PRESENT << 6) | (RELIABLE_PACKET << 7);
  h[1] = HCI_PACKET_TYPE | ((data.length & 0x000f) << 4);
  h[2] = (data.length & 0x0ff0) >> 4;
  h[3] = (~(h[0] + h[1] + h[2]) + 1) & 0xff;

  const combined = concat(h, data);
  const crc = crc16Nordic(combined);
  const encoded = slipEncode(
    concat(combined, new Uint8Array([crc & 0xff, (crc >> 8) & 0xff]))
  );

  const pkt = new Uint8Array(1 + encoded.length + 1);
  pkt[0] = SLIP_END;
  pkt.set(encoded, 1);
  pkt[pkt.length - 1] = SLIP_END;
  return pkt;
}

// ── DFU session ───────────────────────────────────────────────────────────────

class DfuSession extends SerialStreamSession {
  private rxBuf: number[] = [];
  private seqNum = 0;
  private resolveAck: ((ack: number) => void) | null = null;
  private rejectAck: ((err: Error) => void) | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    port: SerialPort,
    signal: AbortSignal | undefined,
    private readonly log: (line: string) => void
  ) {
    super(port, signal);
  }

  protected onBytes(bytes: Uint8Array): void {
    for (const b of bytes) {
      if (b !== SLIP_END) {
        this.rxBuf.push(b);
        continue;
      }
      this.onFrame(this.rxBuf);
      this.rxBuf = [];
    }
  }

  // Fails the pending and later ACK waits right away instead of timing
  // each one out.
  protected onEnded(err: Error): void {
    this.rejectAck?.(err);
  }

  private onFrame(raw: number[]): void {
    if (raw.length < 2 || !this.resolveAck) return;
    let decoded: Uint8Array;
    try {
      decoded = slipDecode(new Uint8Array(raw));
    } catch {
      return; // Malformed frame; keep waiting.
    }
    if (decoded.length === 0) return;
    if (this.ackTimer !== null) clearTimeout(this.ackTimer);
    this.resolveAck((decoded[0] >> 3) & 0x07);
    this.resolveAck = null;
  }

  private waitAck(): Promise<number> {
    if (this.readEnded) return Promise.reject(this.readEnded);
    const ack = new Promise<number>((resolve, reject) => {
      this.resolveAck = resolve;
      this.rejectAck = reject;
      this.ackTimer = setTimeout(() => reject(new Error("ACK timeout")), ACK_TIMEOUT_MS);
    });
    return this.race(ack).finally(() => {
      if (this.ackTimer !== null) clearTimeout(this.ackTimer);
      this.resolveAck = null;
      this.rejectAck = null;
    });
  }

  async sendPacket(data: Uint8Array): Promise<void> {
    this.seqNum = (this.seqNum + 1) % 8;
    const pkt = buildHciPacket(data, this.seqNum);

    for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt++) {
      await this.writeBytes(pkt);
      try {
        await this.waitAck();
        return;
      } catch (err) {
        if (this.signal?.aborted || this.readEnded) throw err;
        // Timed out; resend.
      }
    }
    throw new Error(`Failed to receive ACK after ${MAX_SEND_ATTEMPTS} attempts`);
  }

  async sendStartDfu(
    mode: number,
    sdSize: number,
    blSize: number,
    appSize: number
  ): Promise<void> {
    const frame = concat(
      int32LE(DFU_START_PACKET),
      int32LE(mode),
      int32LE(sdSize),
      int32LE(blSize),
      int32LE(appSize)
    );
    const totalSize = sdSize + blSize + appSize;
    const eraseMs = Math.max(500, (Math.floor(totalSize / 4096) + 1) * PAGE_ERASE_MS);
    this.log(`Sending the start packet; waiting ${Math.round(eraseMs)} ms for the erase`);
    await this.sendPacket(frame);
    await this.race(sleep(eraseMs));
  }

  async sendInitPacket(dat: Uint8Array): Promise<void> {
    this.log(`Sending the init packet (${dat.length} bytes)`);
    const frame = concat(int32LE(DFU_INIT_PACKET), dat, new Uint8Array([0x00, 0x00]));
    await this.sendPacket(frame);
  }

  async sendFirmware(bin: Uint8Array, onPercent: (p: number) => void): Promise<void> {
    const chunkCount = Math.ceil(bin.length / DFU_PACKET_MAX_SIZE);
    this.log(`Transferring in ${chunkCount} packets`);
    const tenth = tenthLogger(this.log, "Transferring");
    for (let i = 0; i < chunkCount; i++) {
      const chunk = bin.subarray(i * DFU_PACKET_MAX_SIZE, (i + 1) * DFU_PACKET_MAX_SIZE);
      await this.sendPacket(concat(int32LE(DFU_DATA_PACKET), chunk));
      const percent = Math.floor(((i + 1) / chunkCount) * 100);
      onPercent(percent);
      tenth(percent);
      if (i > 0 && i % 8 === 0) await this.race(sleep(PAGE_WRITE_MS));
    }

    await this.race(sleep(PAGE_WRITE_MS));
    this.log("Sending the stop packet");
    await this.sendPacket(int32LE(DFU_STOP_DATA_PACKET));
    onPercent(100);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the full DFU sequence on a closed port (opened at 115200, closed after).
 * The abort in ``options`` stops between packets and releases the port; the
 * bootloader stays in DFU mode for a retry.
 */
export async function flashDfuPackage(
  port: SerialPort,
  pkg: DfuPackage,
  { onProgress, onLog, signal }: DfuFlashHooks
): Promise<void> {
  const log = onLog ?? (() => {});
  if (!port.readable) {
    log("Opening the DFU port at 115200 baud");
    await port.open({ baudRate: 115200 });
  }
  let session: DfuSession | undefined;
  let failure: unknown;
  try {
    session = new DfuSession(port, signal, log);
    for (let i = 0; i < pkg.parts.length; i++) {
      const part = pkg.parts[i];
      const base = (i / pkg.parts.length) * 100;
      const range = 100 / pkg.parts.length;

      onProgress(base);
      log(
        `Image ${i + 1} of ${pkg.parts.length}: ${part.type} (${part.bin.length} bytes)`
      );

      let sdSize = 0;
      let blSize = 0;
      let appSize = 0;

      if (part.type === "application") {
        appSize = part.bin.length;
      } else if (part.type === "bootloader") {
        blSize = part.bin.length;
      } else if (part.type === "softdevice") {
        sdSize = part.bin.length;
      } else {
        sdSize = part.sdSize ?? 0;
        blSize = part.blSize ?? 0;
        if (sdSize === 0 || blSize === 0 || sdSize + blSize !== part.bin.length) {
          throw new Error("softdevice+bootloader size mismatch in manifest");
        }
      }

      await session.sendStartDfu(part.mode, sdSize, blSize, appSize);
      await session.sendInitPacket(part.dat);
      await session.sendFirmware(part.bin, (pct) => {
        onProgress(base + (pct * range) / 100);
      });
    }
    log("Transfer complete; closing the port reboots the device into the firmware");
  } catch (err) {
    failure = err;
    throw err;
  } finally {
    markSerialActivity(); // the close reboots the board; its return is ours
    // Both are best effort: the port must always be closed so a retry can
    // reopen it, and neither may replace the error that ended the flash.
    try {
      await session?.close(failure);
    } catch {
      // ignore
    }
    try {
      await port.close();
    } catch {
      // ignore
    }
  }
}

/** The device dropped off the bus (unplug, bootloader reset) rather than a protocol failure. */
export function isDeviceLost(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "NetworkError") ||
    (err instanceof Error && err.message === "Serial port closed")
  );
}

/**
 * ``flashDfuPackage``, retried once from the start if the device drops
 * mid-transfer: waits out the re-enumeration window for the granted handle
 * to come back (no picker needed) and flashes again. Any other failure, an
 * abort, or the device staying gone rethrows the original error.
 */
export async function flashDfuPackageWithReconnect(
  port: SerialPort,
  pkg: DfuPackage,
  hooks: DfuFlashHooks
): Promise<void> {
  const { signal, onReconnecting } = hooks;
  const log = hooks.onLog ?? (() => {});
  try {
    await flashDfuPackage(port, pkg, hooks);
  } catch (err) {
    if (signal?.aborted || !isDeviceLost(err)) throw err;
    log("The device dropped off the bus mid-flash; waiting for it to re-enumerate");
    onReconnecting?.();
    const live = await openLiveSerialPort(port, {
      baudRate: 115200,
      timeoutMs: SERIAL_REOPEN_TIMEOUT_MS,
      cancelled: () => signal?.aborted === true,
    });
    if (!live) {
      log("The device did not come back");
      throw err;
    }
    log("Reacquired the DFU port; flashing again from the start");
    await flashDfuPackage(live, pkg, hooks);
  }
}
