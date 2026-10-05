/**
 * LibreTiny's UF2 flavour: standard 512-byte blocks whose payload is followed
 * by tagged extension data. The header block (not main flash) names the
 * board and carries the partition table; every group of data blocks opens
 * with an OTA_PART_INFO tag naming, per OTA scheme, the partition it belongs
 * to. This resolves the scheme a family's UART flasher writes into absolute
 * flash runs.
 */
import {
  parseUf2Blocks,
  requireUf2Family,
  UF2_BLOCK_SIZE,
  UF2_FLAG_HAS_TAGS,
  UF2_FLAG_NOT_MAIN_FLASH,
  type Uf2Range,
} from "../util/uf2.js";

export const LT_TAG = {
  OTA_FORMAT_2: 0x6c8492,
  OTA_PART_INFO: 0xc0ee0c,
  BOARD: 0xca25c8,
  BINPATCH: 0xb948de,
  FAL_PTABLE: 0x8288ed,
} as const;

// BINPATCH opcode: add a signed 32-bit delta to the words at the listed offsets.
const BINPATCH_DIFF32 = 0xfe;

/**
 * Where each scheme's partition index sits in OTA_PART_INFO, one nibble per
 * scheme (device single, OTA1, OTA2, flasher single, OTA1, OTA2), and
 * whether its blocks take the BINPATCH that relocates OTA1 to OTA2.
 */
const SCHEMES: Record<LibreTinyScheme, { nibble: number; binpatch: boolean }> = {
  "flasher-single": { nibble: 3, binpatch: false },
  "flasher-ota1": { nibble: 4, binpatch: false },
  "flasher-ota2": { nibble: 5, binpatch: true },
};

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

/**
 * The scheme of OTA_PART_INFO a flasher writes, as ltchiptool picks it per
 * family: a chip with one image slot takes the single scheme, one with two
 * takes the first slot, or the slot its bootloader will run next.
 */
export type LibreTinyScheme = "flasher-single" | "flasher-ota1" | "flasher-ota2";

export interface LibreTinyParseOptions {
  scheme: LibreTinyScheme;
  /** What the flasher writes at a time; a run is padded to it in flash. */
  blockSize: number;
  /**
   * Where the blocks lie: from the start of the run (a transfer that begins
   * at its address), or on the grid of the flash (sectors that are erased
   * and written whole, so a run is padded at its head as well).
   */
  blocksFrom: "run" | "flash";
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

/** The partition this block group targets under *scheme*, or null. */
function partInfoTarget(info: Uint8Array, scheme: LibreTinyScheme): string | null {
  if (info.length < 3) throw new Error("Invalid UF2: OTA_PART_INFO too short");
  const names = decoder.decode(info.subarray(3)).split("\0").filter(Boolean);
  const { nibble } = SCHEMES[scheme];
  const byte = info[nibble >> 1];
  const index = nibble & 1 ? byte & 0x0f : byte >> 4;
  if (index === 0) return null;
  const name = names[index - 1];
  if (!name) throw new Error("Invalid UF2: OTA_PART_INFO names too few partitions");
  return name;
}

/**
 * Apply a block's BINPATCH (the OTA1 to OTA2 relocation) to a copy of its
 * data. Anything it cannot apply in full is a bad file, never a slot with
 * only some of its pointers moved.
 */
function applyBinpatch(data: Uint8Array, patch: Uint8Array): Uint8Array {
  if (patch.length === 0) throw new Error("Invalid UF2: BINPATCH empty");
  const out = data.slice();
  const view = new DataView(out.buffer);
  for (let i = 0; i < patch.length;) {
    if (i + 2 > patch.length || i + 2 + patch[i + 1] > patch.length) {
      throw new Error("Invalid UF2: BINPATCH truncated");
    }
    const opcode = patch[i];
    const body = patch.subarray(i + 2, i + 2 + patch[i + 1]);
    i += 2 + body.length;
    if (opcode !== BINPATCH_DIFF32) {
      throw new Error(`Invalid UF2: unknown BINPATCH opcode 0x${opcode.toString(16)}`);
    }
    if (body.length < 4) throw new Error("Invalid UF2: BINPATCH DIFF32 too short");
    // ltchiptool always lists an offset; one without would count as patched.
    if (body.length === 4)
      throw new Error("Invalid UF2: BINPATCH DIFF32 patches nothing");
    const diff = new DataView(body.buffer, body.byteOffset, 4).getInt32(0, true);
    for (const offset of body.subarray(4)) {
      // uf2tool diffs the blocks in 4-byte chunks, so a real patch is word aligned.
      if (offset % 4)
        throw new Error(`Invalid UF2: BINPATCH offset ${offset} not word aligned`);
      if (offset + 4 > out.length)
        throw new Error("Invalid UF2: BINPATCH past the block");
      view.setUint32(offset, (view.getUint32(offset, true) + diff) >>> 0, true);
    }
  }
  return out;
}

/**
 * Parse a LibreTiny UF2 for a UART flasher. The family must be one of
 * ``allowedFamilies`` (a ``Uf2FamilyError`` names the one refused); the
 * file must carry its partition table, which every LibreTiny build does.
 */
export function parseLibreTinyImage(
  bytes: Uint8Array,
  allowedFamilies: readonly number[],
  options: LibreTinyParseOptions
): LibreTinyImage {
  return libreTinyImageFor(parseLibreTinyFile(bytes, allowedFamilies), options);
}

/** A LibreTiny UF2 read once, for resolving one or more schemes from it. */
export interface LibreTinyFile {
  familyId: number;
  board: string;
  partitions: LibreTinyPartition[];
  blocks: LibreTinyBlock[];
}

/** The blocks, header tags and partition table, checked as ``parseLibreTinyImage`` does. */
export function parseLibreTinyFile(
  bytes: Uint8Array,
  allowedFamilies: readonly number[]
): LibreTinyFile {
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
  return { familyId, board, partitions: parsePartitionTable(table), blocks };
}

/** One scheme's flash runs from a parsed file. */
export function libreTinyImageFor(
  { familyId, board, partitions, blocks }: LibreTinyFile,
  { scheme, blockSize, blocksFrom }: LibreTinyParseOptions
): LibreTinyImage {
  const { binpatch } = SCHEMES[scheme];

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
  let patched = false;
  for (const b of blocks) {
    if (b.notMainFlash) continue;
    const info = b.tags.get(LT_TAG.OTA_PART_INFO);
    if (info) {
      grouped = true;
      const name = partInfoTarget(info, scheme);
      part = name ? (partitions.find((p) => p.name === name) ?? null) : null;
      if (name && !part) throw new Error(`Invalid UF2: partition '${name}' not in table`);
    }
    if (b.data.length === 0) continue;
    if (!grouped) throw new Error("Invalid UF2: data block before OTA_PART_INFO");
    if (!part) continue;
    const patch = binpatch ? b.tags.get(LT_TAG.BINPATCH) : undefined;
    const data = patch ? applyBinpatch(b.data, patch) : b.data;
    patched ||= patch !== undefined;
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
    for (let i = 0; i < data.length; i++) run.bytes[run.cursor + i] = data[i];
    run.cursor += data.length;
  }
  if (runs.length === 0) throw new Error("Invalid UF2: nothing to flash");
  // Unrelocated, the first slot's image would run with pointers into it.
  if (binpatch && !patched)
    throw new Error("Invalid UF2: no BINPATCH for the second slot");
  // The flasher writes whole blocks, so a run's padding lands in flash too:
  // it must not reach into another partition, nor into another run of the
  // same partition (that run would be overwritten, or erased).
  const up = (n: number) => Math.ceil(n / blockSize) * blockSize;
  const written = (r: { address: number; bytes: number[] }) => {
    const start =
      blocksFrom === "flash" ? r.address - (r.address % blockSize) : r.address;
    return { start, end: start + up(r.address - start + r.bytes.length) };
  };
  for (const r of runs) {
    const { start, end } = written(r);
    if (start < r.part.offset || end > r.part.offset + r.part.length) {
      throw new Error(
        `Invalid UF2: run at 0x${r.address.toString(16)} pads past '${r.part.name}'`
      );
    }
  }
  const ordered = [...runs].sort((a, b) => a.address - b.address);
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const next = ordered[i];
    if (prev.part === next.part && written(prev).end > written(next).start) {
      throw new Error(
        `Invalid UF2: runs at 0x${prev.address.toString(16)} and 0x${next.address.toString(16)} overlap in '${prev.part.name}'`
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
