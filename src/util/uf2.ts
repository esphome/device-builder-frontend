/**
 * UF2 container parsing (https://github.com/microsoft/uf2): 512-byte blocks,
 * each carrying one flash page. Only what the RP2 flashers need: validate the
 * container, group the pages into contiguous address ranges, and check the
 * family id against what the caller can flash.
 */
import { concat } from "./bytes.js";

const UF2_BLOCK_SIZE = 512;
export const UF2_MAGIC_START0 = 0x0a324655;
export const UF2_MAGIC_START1 = 0x9e5d5157;
export const UF2_MAGIC_END = 0x0ab16f30;
export const UF2_FLAG_NOT_MAIN_FLASH = 0x0001;
export const UF2_FLAG_FAMILY_ID_PRESENT = 0x2000;
const UF2_MAX_PAYLOAD = 476;

export const UF2_FAMILY_RP2040 = 0xe48bff56;
export const UF2_FAMILY_RP2350_ARM_S = 0xe48bff59;

export interface Uf2Block {
  targetAddr: number;
  familyId: number | null;
  data: Uint8Array;
}

export interface Uf2Range {
  address: number;
  data: Uint8Array<ArrayBuffer>;
}

export interface Uf2Image {
  familyId: number | null;
  ranges: Uf2Range[];
  totalBytes: number;
}

/** The image targets a chip family the caller can't flash. */
export class Uf2FamilyError extends Error {
  constructor(readonly familyId: number | null) {
    super(
      `UF2 family ${
        familyId === null ? "none" : `0x${familyId.toString(16).padStart(8, "0")}`
      } is not supported`
    );
    this.name = "Uf2FamilyError";
  }
}

export function parseUf2Blocks(bytes: Uint8Array): Uf2Block[] {
  if (bytes.length === 0 || bytes.length % UF2_BLOCK_SIZE !== 0) {
    throw new Error(`Invalid UF2: length ${bytes.length} is not a multiple of 512`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length / UF2_BLOCK_SIZE;
  const blocks: Uf2Block[] = [];
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
    if (payloadSize === 0 || payloadSize > UF2_MAX_PAYLOAD) {
      throw new Error(`Invalid UF2: block ${i} payload size ${payloadSize}`);
    }
    const numBlocks = view.getUint32(off + 24, true);
    if (numBlocks !== count) {
      throw new Error(
        `Invalid UF2: block ${i} claims ${numBlocks} blocks, file has ${count}`
      );
    }
    if (flags & UF2_FLAG_NOT_MAIN_FLASH) continue;
    blocks.push({
      targetAddr: view.getUint32(off + 12, true),
      familyId:
        flags & UF2_FLAG_FAMILY_ID_PRESENT ? view.getUint32(off + 28, true) : null,
      data: bytes.subarray(off + 32, off + 32 + payloadSize),
    });
  }
  return blocks;
}

/** Merge page blocks into contiguous, ascending address ranges. */
export function blocksToRanges(blocks: Uf2Block[]): Uf2Range[] {
  const sorted = [...blocks].sort((a, b) => a.targetAddr - b.targetAddr);
  const runs: { address: number; parts: Uint8Array[]; length: number }[] = [];
  for (const b of sorted) {
    const last = runs[runs.length - 1];
    const end = last ? last.address + last.length : -1;
    if (last && b.targetAddr < end) {
      throw new Error(`Invalid UF2: overlapping block at 0x${b.targetAddr.toString(16)}`);
    }
    if (last && b.targetAddr === end) {
      last.parts.push(b.data);
      last.length += b.data.length;
    } else {
      runs.push({ address: b.targetAddr, parts: [b.data], length: b.data.length });
    }
  }
  return runs.map((run) => ({ address: run.address, data: concat(...run.parts) }));
}

/**
 * Parse a UF2 for flashing. Every block must carry the same family id and it
 * must be one of ``allowedFamilies``; anything else is a ``Uf2FamilyError`` so
 * the caller can name the chip it refused.
 */
export function parseUf2Image(
  bytes: Uint8Array,
  allowedFamilies: readonly number[]
): Uf2Image {
  const blocks = parseUf2Blocks(bytes);
  if (blocks.length === 0) throw new Error("Invalid UF2: no flash blocks");
  const familyId = blocks[0].familyId;
  if (blocks.some((b) => b.familyId !== familyId)) {
    throw new Error("Invalid UF2: blocks target different chip families");
  }
  if (familyId === null || !allowedFamilies.includes(familyId)) {
    throw new Uf2FamilyError(familyId);
  }
  const ranges = blocksToRanges(blocks);
  return { familyId, ranges, totalBytes: ranges.reduce((n, r) => n + r.data.length, 0) };
}
