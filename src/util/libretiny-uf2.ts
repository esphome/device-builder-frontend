/**
 * LibreTiny's UF2 flavour: standard 512-byte blocks whose payload is followed
 * by tagged extension data. The header block (not main flash) names the
 * board and carries the partition table; every group of data blocks opens
 * with an OTA_PART_INFO tag naming, per OTA scheme, the partition it belongs
 * to. This resolves the UART flasher's scheme (always the first OTA slot, as
 * ltchiptool does) into absolute flash runs.
 */
import {
  parseUf2Blocks,
  requireUf2Family,
  UF2_BLOCK_SIZE,
  UF2_FLAG_HAS_TAGS,
  UF2_FLAG_NOT_MAIN_FLASH,
  type Uf2Range,
} from "./uf2.js";
import { XMODEM_BLOCK_SIZE } from "./xmodem.js";

/** Realtek AmebaZ2 (RTL8720C), the family the UART engine can flash. */
export const UF2_FAMILY_AMBZ2 = 0xe08f7564;
/** Realtek AmebaZ (RTL8710B): a different ROM protocol, refused up front. */
export const UF2_FAMILY_AMBZ = 0x22e0d6fc;

export const LT_TAG = {
  OTA_FORMAT_2: 0x6c8492,
  OTA_PART_INFO: 0xc0ee0c,
  BOARD: 0xca25c8,
  FAL_PTABLE: 0x8288ed,
} as const;

// FAL partition table entry: magic, name[16], flash name[16], offset, length, pad.
export const PARTITION_ENTRY_SIZE = 48;
export const PARTITION_MAGIC = 0x45503130;

export interface LibreTinyPartition {
  name: string;
  offset: number;
  length: number;
}

export interface LibreTinyImage {
  familyId: number;
  board: string;
  /** Absolute flash runs in file order, contiguous pages joined. */
  runs: Uf2Range[];
  totalBytes: number;
}

export interface LibreTinyBlock {
  address: number;
  familyId: number | null;
  data: Uint8Array;
  tags: ReadonlyMap<number, Uint8Array>;
  notMainFlash: boolean;
}

const decoder = new TextDecoder();
const NO_TAGS: ReadonlyMap<number, Uint8Array> = new Map();

function parseTags(block: Uint8Array, payloadSize: number): Map<number, Uint8Array> {
  const tags = new Map<number, Uint8Array>();
  const region = block.subarray(32 + payloadSize, UF2_BLOCK_SIZE - 4);
  let i = 0;
  while (i + 4 <= region.length) {
    const size = region[i];
    if (size === 0) break;
    if (size < 4 || i + size > region.length)
      throw new Error("Invalid UF2: malformed tag");
    const type = region[i + 1] | (region[i + 2] << 8) | (region[i + 3] << 16);
    tags.set(type, region.subarray(i + 4, i + size));
    i = Math.ceil((i + size) / 4) * 4;
  }
  return tags;
}

export function parseLibreTinyBlocks(bytes: Uint8Array): LibreTinyBlock[] {
  const blocks = parseUf2Blocks(bytes, {
    keepNotMainFlash: true,
    allowEmptyPayload: true,
  });
  return blocks.map((b) => ({
    address: b.targetAddr,
    familyId: b.familyId,
    data: b.data,
    tags: b.flags & UF2_FLAG_HAS_TAGS ? parseTags(b.block, b.data.length) : NO_TAGS,
    notMainFlash: (b.flags & UF2_FLAG_NOT_MAIN_FLASH) !== 0,
  }));
}

const text = (tag: Uint8Array | undefined): string =>
  tag ? decoder.decode(tag).replace(/\0+$/, "") : "";

export function parsePartitionTable(table: Uint8Array): LibreTinyPartition[] {
  if (table.length % PARTITION_ENTRY_SIZE !== 0) {
    throw new Error(`Invalid partition table: ${table.length} bytes`);
  }
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const partitions: LibreTinyPartition[] = [];
  for (let off = 0; off < table.length; off += PARTITION_ENTRY_SIZE) {
    if (view.getUint32(off, true) !== PARTITION_MAGIC) {
      throw new Error(
        `Invalid partition table: bad magic at entry ${off / PARTITION_ENTRY_SIZE}`
      );
    }
    partitions.push({
      name: text(table.subarray(off + 4, off + 20)),
      offset: view.getUint32(off + 36, true),
      length: view.getUint32(off + 40, true),
    });
  }
  return partitions;
}

/** The partition this block group targets under the flasher's scheme, or null. */
function partInfoTarget(info: Uint8Array): string | null {
  if (info.length < 3) throw new Error("Invalid UF2: OTA_PART_INFO too short");
  const names = decoder.decode(info.subarray(3)).split("\0").filter(Boolean);
  // One nibble per scheme (device single, device OTA1, device OTA2, flasher
  // single, flasher OTA1, flasher OTA2); the UART flasher writes the OTA1 layout.
  const index = info[2] >> 4;
  if (index === 0) return null;
  const name = names[index - 1];
  if (!name) throw new Error("Invalid UF2: OTA_PART_INFO names too few partitions");
  return name;
}

/**
 * Parse a LibreTiny UF2 for the UART flasher. The family must be one of
 * ``allowedFamilies`` (a ``Uf2FamilyError`` names the one refused); the
 * file must carry its partition table, which every LibreTiny build does.
 */
export function parseLibreTinyImage(
  bytes: Uint8Array,
  allowedFamilies: readonly number[]
): LibreTinyImage {
  const blocks = parseLibreTinyBlocks(bytes);
  const familyId = requireUf2Family(blocks, allowedFamilies);
  // File-level tags live on the header and any other non-flash blocks.
  const fileTags = new Map<number, Uint8Array>();
  for (const b of blocks) {
    if (b.notMainFlash || b.data.length === 0) {
      for (const [k, v] of b.tags) fileTags.set(k, v);
    }
  }
  if (!fileTags.has(LT_TAG.OTA_FORMAT_2)) {
    throw new Error("Invalid UF2: legacy LibreTiny format");
  }
  const board = text(fileTags.get(LT_TAG.BOARD));
  if (!board) throw new Error("Invalid UF2: no board name");
  const table = fileTags.get(LT_TAG.FAL_PTABLE);
  if (!table) throw new Error("Invalid UF2: no partition table");
  const partitions = parsePartitionTable(table);

  // A run grows at its cursor; LibreTiny writes an image's header as a
  // later group that lands back on the partition start, which rewinds the
  // cursor and overwrites the first pages in place (the body stays).
  const runs: {
    part: LibreTinyPartition;
    address: number;
    bytes: number[];
    cursor: number;
  }[] = [];
  let part: LibreTinyPartition | null = null;
  let grouped = false;
  for (const b of blocks) {
    if (b.notMainFlash) continue;
    const info = b.tags.get(LT_TAG.OTA_PART_INFO);
    if (info) {
      grouped = true;
      const name = partInfoTarget(info);
      part = name ? (partitions.find((p) => p.name === name) ?? null) : null;
      if (name && !part) throw new Error(`Invalid UF2: partition '${name}' not in table`);
    }
    if (b.data.length === 0) continue;
    if (!grouped) throw new Error("Invalid UF2: data block before OTA_PART_INFO");
    if (!part) continue;
    if (b.address + b.data.length > part.length) {
      throw new Error(
        `Invalid UF2: page at 0x${b.address.toString(16)} past '${part.name}'`
      );
    }
    const address = part.offset + b.address;
    // Runs never cross a partition, so the lookup stays inside this one: a
    // page on a run's start rewinds it, a page at its cursor continues it.
    const own = runs.filter((r) => r.part === part);
    let run = own.find((r) => r.address === address);
    if (run) run.cursor = 0;
    else run = own.find((r) => r.address + r.cursor === address);
    if (!run) {
      run = { part, address, bytes: [], cursor: 0 };
      runs.push(run);
    }
    for (let i = 0; i < b.data.length; i++) run.bytes[run.cursor + i] = b.data[i];
    run.cursor += b.data.length;
  }
  if (runs.length === 0) throw new Error("Invalid UF2: nothing to flash");
  for (const r of runs) {
    // The UART flasher sends whole XModem blocks, so a run's tail padding
    // lands in flash too; it must not reach into the next partition.
    const padded = Math.ceil(r.bytes.length / XMODEM_BLOCK_SIZE) * XMODEM_BLOCK_SIZE;
    if (r.address + padded > r.part.offset + r.part.length) {
      throw new Error(
        `Invalid UF2: run at 0x${r.address.toString(16)} pads past '${r.part.name}'`
      );
    }
  }
  const ranges = runs.map((r) => ({
    address: r.address,
    data: new Uint8Array(r.bytes) as Uint8Array<ArrayBuffer>,
  }));
  return {
    familyId,
    board,
    runs: ranges,
    totalBytes: ranges.reduce((n, r) => n + r.data.length, 0),
  };
}
