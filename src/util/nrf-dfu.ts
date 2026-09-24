import { unzipSync } from "fflate";

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

export interface DfuProgress {
  part: number;
  parts: number;
  percent: number;
  label: string;
}

export type DfuProgressCallback = (p: DfuProgress) => void;

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

/**
 * Build a minimal DFU package from a raw application binary when no .zip DFU
 * package is available. Generates a wildcard init packet (any device type/revision,
 * no SoftDevice requirement) with the firmware CRC-16 so the Adafruit bootloader
 * accepts it.
 */
export function makeDfuPackageFromBin(appBin: Uint8Array): DfuPackage {
  const crc = crc16Nordic(appBin);
  const dat = new Uint8Array(12);
  const view = new DataView(dat.buffer);
  view.setUint16(0, 0xffff, true); // device_type: wildcard
  view.setUint16(2, 0xffff, true); // device_revision: wildcard
  view.setUint32(4, 0xffffffff, true); // application_version: any
  view.setUint16(8, 0, true); // softdevice_req_count: 0
  view.setUint16(10, crc, true); // CRC-16 of firmware
  return {
    parts: [{ type: "application", mode: DFU_MODE_APP, bin: appBin, dat }],
  };
}

// ── SLIP framing ─────────────────────────────────────────────────────────────

const SLIP_END = 0xc0;
const SLIP_ESC = 0xdb;
const SLIP_ESC_END = 0xdc;
const SLIP_ESC_ESC = 0xdd;

function slipEncode(data: Uint8Array): Uint8Array {
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

function slipDecode(data: Uint8Array): Uint8Array {
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

function crc16Nordic(data: Uint8Array): number {
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

function int32LE(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const len = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

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

function buildHciPacket(data: Uint8Array, seq: number): Uint8Array {
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

class DfuSession {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private rxBuf: number[] = [];
  private seqNum = 0;
  private resolveAck: ((ack: number) => void) | null = null;
  private ackTimer: ReturnType<typeof setTimeout> | null = null;
  private active = true;

  constructor(port: SerialPort) {
    this.reader = port.readable!.getReader();
    this.writer = port.writable!.getWriter();
    void this.readLoop();
  }

  private async readLoop(): Promise<void> {
    while (this.active) {
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await this.reader.read();
      } catch {
        break;
      }
      if (result.done || !result.value) break;
      for (const b of result.value) {
        if (b === SLIP_END) {
          if (this.rxBuf.length >= 2) {
            try {
              const decoded = slipDecode(new Uint8Array(this.rxBuf));
              if (decoded.length >= 1 && this.resolveAck) {
                const ackNr = (decoded[0] >> 3) & 0x07;
                if (this.ackTimer !== null) clearTimeout(this.ackTimer);
                this.resolveAck(ackNr);
                this.resolveAck = null;
              }
            } catch {
              // Malformed packet — ignore and continue
            }
          }
          this.rxBuf = [];
        } else {
          this.rxBuf.push(b);
        }
      }
    }
  }

  private waitAck(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.resolveAck = resolve;
      this.ackTimer = setTimeout(() => {
        this.resolveAck = null;
        this.seqNum = 0;
        reject(new Error("ACK timeout"));
      }, ACK_TIMEOUT_MS);
    });
  }

  async sendPacket(data: Uint8Array): Promise<void> {
    this.seqNum = (this.seqNum + 1) % 8;
    const pkt = buildHciPacket(data, this.seqNum);

    for (let attempt = 0; attempt < MAX_SEND_ATTEMPTS; attempt++) {
      await this.writer.write(pkt);
      try {
        await this.waitAck();
        return;
      } catch {
        if (attempt === MAX_SEND_ATTEMPTS - 1) {
          throw new Error(`Failed to receive ACK after ${MAX_SEND_ATTEMPTS} attempts`);
        }
      }
    }
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
    await this.sendPacket(frame);
    const totalSize = sdSize + blSize + appSize;
    const eraseMs = Math.max(500, (Math.floor(totalSize / 4096) + 1) * 89.7);
    await sleep(eraseMs);
  }

  async sendInitPacket(dat: Uint8Array): Promise<void> {
    const frame = concat(int32LE(DFU_INIT_PACKET), dat, new Uint8Array([0x00, 0x00]));
    await this.sendPacket(frame);
  }

  async sendFirmware(bin: Uint8Array, onPercent: (p: number) => void): Promise<void> {
    const pageWriteMs = (4096 / 4) * 0.0001 * 1000;

    const chunkCount = Math.ceil(bin.length / DFU_PACKET_MAX_SIZE);
    for (let i = 0; i < chunkCount; i++) {
      const chunk = bin.slice(i * DFU_PACKET_MAX_SIZE, (i + 1) * DFU_PACKET_MAX_SIZE);
      const frame = concat(int32LE(DFU_DATA_PACKET), chunk);
      await this.sendPacket(frame);
      onPercent(Math.floor(((i + 1) / chunkCount) * 100));
      if (i > 0 && i % 8 === 0) await sleep(pageWriteMs);
    }

    await sleep(pageWriteMs);
    await this.sendPacket(int32LE(DFU_STOP_DATA_PACKET));
    onPercent(100);
  }

  async close(): Promise<void> {
    this.active = false;
    try {
      await this.reader.cancel();
    } catch {
      // ignore
    }
    try {
      this.reader.releaseLock();
    } catch {
      // ignore
    }
    try {
      await this.writer.close();
    } catch {
      // ignore
    }
    try {
      this.writer.releaseLock();
    } catch {
      // ignore
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Trigger the nRF52 DFU bootloader by opening at 1200 baud and immediately
 * closing. The device re-enumerates as a DFU serial port after a short delay.
 */
export async function resetToBootloader(port: SerialPort): Promise<void> {
  await port.open({ baudRate: 1200 });
  await port.close();
}

/**
 * Flash a parsed DFU package to a closed serial port.
 * Opens the port at 115200 baud, runs the full DFU sequence, then closes it.
 */
export async function flashDfuPackage(
  port: SerialPort,
  pkg: DfuPackage,
  onProgress: DfuProgressCallback
): Promise<void> {
  await port.open({ baudRate: 115200 });
  const session = new DfuSession(port);
  try {
    for (let i = 0; i < pkg.parts.length; i++) {
      const part = pkg.parts[i];
      const base = (i / pkg.parts.length) * 100;
      const range = 100 / pkg.parts.length;

      onProgress({ part: i, parts: pkg.parts.length, percent: base, label: part.type });

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
        onProgress({
          part: i,
          parts: pkg.parts.length,
          percent: base + (pct * range) / 100,
          label: part.type,
        });
      });
    }
  } finally {
    await session.close();
    try {
      await port.close();
    } catch {
      // ignore
    }
  }
}
