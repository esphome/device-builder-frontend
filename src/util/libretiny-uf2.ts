/**
 * LibreTiny's UF2 flavour: standard 512-byte blocks whose payload is followed
 * by tagged extension data. The header block (not main flash) names the
 * board and carries the partition table; every group of data blocks opens
 * with an OTA_PART_INFO tag naming, per OTA scheme, the partition it belongs
 * to. This resolves the UART flasher's scheme (always the first OTA slot, as
 * ltchiptool does) into absolute flash runs.
 */
import { concat } from "./bytes.js";
import {
  UF2_FLAG_FAMILY_ID_PRESENT,
  UF2_FLAG_NOT_MAIN_FLASH,
  UF2_MAGIC_END,
  UF2_MAGIC_START0,
  UF2_MAGIC_START1,
  Uf2FamilyError,
  type Uf2Range,
} from "./uf2.js";

const UF2_BLOCK_SIZE = 512;
const UF2_MAX_PAYLOAD = 476;
export const UF2_FLAG_HAS_TAGS = 0x8000;

/** Realtek AmebaZ2 (RTL8720C), the family the UART engine can flash. */
export const UF2_FAMILY_AMBZ2 = 0xe08f7564;
/** Realtek AmebaZ (RTL8710B): a different ROM protocol, refused up front. */
export const UF2_FAMILY_AMBZ = 0x22e0d6fc;

export const LT_TAG = {
  VERSION: 0x9fc7bc,
  OTA_FORMAT_2: 0x6c8492,
  OTA_PART_INFO: 0xc0ee0c,
  BOARD: 0xca25c8,
  FIRMWARE: 0x00de43,
  FAL_PTABLE: 0x8288ed,
} as const;

// OTA_PART_INFO holds one partition index per scheme, in this order:
// device single, device OTA1, device OTA2, flasher single, flasher OTA1,
// flasher OTA2. The UART flasher always writes the OTA1 layout.
const SCHEME_FLASHER_DUAL_1 = 4;

// FAL partition table entry: magic, name[16], flash name[16], offset, length, pad.
const PARTITION_ENTRY_SIZE = 48;
const PARTITION_MAGIC = 0x45503130;

export interface LibreTinyPartition {
  name: string;
  offset: number;
  length: number;
}

export interface LibreTinyImage {
  familyId: number;
  board: string;
  firmware: string;
  version: string;
  /** Absolute flash runs in file order, contiguous pages joined. */
  runs: Uf2Range[];
  totalBytes: number;
}

interface LtBlock {
  address: number;
  familyId: number | null;
  data: Uint8Array;
  tags: Map<number, Uint8Array>;
  notMainFlash: boolean;
}

const decoder = new TextDecoder();

function parseTags(block: Uint8Array, payloadSize: number): Map<number, Uint8Array> {
  const tags = new Map<number, Uint8Array>();
  const region = block.subarray(32 + payloadSize, UF2_BLOCK_SIZE - 4);
  let i = 0;
  while (i + 4 <= region.length) {
    const size = region[i];
    if (size === 0) break;
    const type = region[i + 1] | (region[i + 2] << 8) | (region[i + 3] << 16);
    tags.set(type, region.subarray(i + 4, i + size));
    i = Math.ceil((i + size) / 4) * 4;
  }
  return tags;
}

export function parseLibreTinyBlocks(bytes: Uint8Array): LtBlock[] {
  if (bytes.length === 0 || bytes.length % UF2_BLOCK_SIZE !== 0) {
    throw new Error(`Invalid UF2: length ${bytes.length} is not a multiple of 512`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length / UF2_BLOCK_SIZE;
  const blocks: LtBlock[] = [];
  for (let i = 0; i < count; i++) {
    const off = i * UF2_BLOCK_SIZE;
    if (
      view.getUint32(off, true) !== UF2_MAGIC_START0 ||
      view.getUint32(off + 4, true) !== UF2_MAGIC_START1 ||
      view.getUint32(off + 508, true) !== UF2_MAGIC_END
    ) {
      throw new Error(`Invalid UF2: bad magic in block ${i}`);
    }
    const flags = view.getUint32(off + 8, true);
    const payloadSize = view.getUint32(off + 16, true);
    if (payloadSize > UF2_MAX_PAYLOAD) {
      throw new Error(`Invalid UF2: block ${i} payload size ${payloadSize}`);
    }
    if (view.getUint32(off + 24, true) !== count) {
      throw new Error(`Invalid UF2: block ${i} block count does not match the file`);
    }
    const block = bytes.subarray(off, off + UF2_BLOCK_SIZE);
    blocks.push({
      address: view.getUint32(off + 12, true),
      familyId:
        flags & UF2_FLAG_FAMILY_ID_PRESENT ? view.getUint32(off + 28, true) : null,
      data: block.subarray(32, 32 + payloadSize),
      tags: flags & UF2_FLAG_HAS_TAGS ? parseTags(block, payloadSize) : new Map(),
      notMainFlash: (flags & UF2_FLAG_NOT_MAIN_FLASH) !== 0,
    });
  }
  return blocks;
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
      throw new Error(`Invalid partition table: bad magic at entry ${off / 48}`);
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
  const digit = info[SCHEME_FLASHER_DUAL_1 >> 1];
  const index = SCHEME_FLASHER_DUAL_1 % 2 === 0 ? digit >> 4 : digit & 0xf;
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
  if (blocks.length === 0) throw new Error("Invalid UF2: no blocks");
  const familyId = blocks[0].familyId;
  if (blocks.some((b) => b.familyId !== familyId)) {
    throw new Error("Invalid UF2: blocks target different chip families");
  }
  if (familyId === null || !allowedFamilies.includes(familyId)) {
    throw new Uf2FamilyError(familyId);
  }
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

  const runs: { address: number; parts: Uint8Array[]; length: number }[] = [];
  let part: LibreTinyPartition | null = null;
  for (const b of blocks) {
    if (b.notMainFlash) continue;
    const info = b.tags.get(LT_TAG.OTA_PART_INFO);
    if (info) {
      const name = partInfoTarget(info);
      part = name ? (partitions.find((p) => p.name === name) ?? null) : null;
      if (name && !part) throw new Error(`Invalid UF2: partition '${name}' not in table`);
    }
    if (!part || b.data.length === 0) continue;
    if (b.address >= part.length) {
      throw new Error(
        `Invalid UF2: offset 0x${b.address.toString(16)} past '${part.name}'`
      );
    }
    const address = part.offset + b.address;
    const tail = runs.find((r) => r.address + r.length === address);
    if (tail) {
      tail.parts.push(b.data);
      tail.length += b.data.length;
      continue;
    }
    // A group that restarts at a known offset rewrites that run from its start.
    const existing = runs.find((r) => r.address === address);
    if (existing) {
      existing.parts = [b.data];
      existing.length = b.data.length;
    } else {
      runs.push({ address, parts: [b.data], length: b.data.length });
    }
  }
  if (runs.length === 0) throw new Error("Invalid UF2: nothing to flash");
  const ranges = runs.map((r) => ({ address: r.address, data: concat(...r.parts) }));
  return {
    familyId,
    board,
    firmware: text(fileTags.get(LT_TAG.FIRMWARE)),
    version: text(fileTags.get(LT_TAG.VERSION)),
    runs: ranges,
    totalBytes: ranges.reduce((n, r) => n + r.data.length, 0),
  };
}
