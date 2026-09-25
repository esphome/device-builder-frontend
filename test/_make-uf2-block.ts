import {
  UF2_FAMILY_RP2040,
  UF2_FLAG_FAMILY_ID_PRESENT,
  UF2_FLAG_HAS_TAGS,
  UF2_MAGIC_END,
  UF2_MAGIC_START0,
  UF2_MAGIC_START1,
} from "../src/util/uf2.js";

export interface Uf2Tag {
  type: number;
  data: Uint8Array;
}

export interface Uf2BlockSpec {
  addr: number;
  blockNo?: number;
  numBlocks?: number;
  /** ``null`` omits the family id entirely. Defaults to RP2040. */
  family?: number | null;
  fill?: number;
  flags?: number;
  payload?: number;
  /** Explicit payload bytes; wins over ``payload`` / ``fill``. */
  data?: Uint8Array;
  /** LibreTiny extension tags appended after the payload. */
  tags?: Uf2Tag[];
  magicEnd?: number;
}

/** One 512-byte UF2 block with a 256-byte payload of ``fill`` (default blockNo + 1). */
export function makeUf2Block(spec: Uf2BlockSpec): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(512);
  const v = new DataView(b.buffer);
  const blockNo = spec.blockNo ?? 0;
  const family = spec.family === undefined ? UF2_FAMILY_RP2040 : spec.family;
  const payload = spec.data ? spec.data.length : (spec.payload ?? 256);
  const flags =
    (spec.flags ?? 0) |
    (family === null ? 0 : UF2_FLAG_FAMILY_ID_PRESENT) |
    (spec.tags?.length ? UF2_FLAG_HAS_TAGS : 0);
  v.setUint32(0, UF2_MAGIC_START0, true);
  v.setUint32(4, UF2_MAGIC_START1, true);
  v.setUint32(8, flags, true);
  v.setUint32(12, spec.addr, true);
  v.setUint32(16, payload, true);
  v.setUint32(20, blockNo, true);
  v.setUint32(24, spec.numBlocks ?? 1, true);
  if (family !== null) v.setUint32(28, family, true);
  if (spec.data) b.set(spec.data, 32);
  else b.fill(spec.fill ?? blockNo + 1, 32, 32 + payload);
  let off = 32 + payload;
  for (const tag of spec.tags ?? []) {
    const size = 4 + tag.data.length;
    b[off] = size;
    b[off + 1] = tag.type & 0xff;
    b[off + 2] = (tag.type >> 8) & 0xff;
    b[off + 3] = (tag.type >> 16) & 0xff;
    b.set(tag.data, off + 4);
    off = Math.ceil((off + size) / 4) * 4;
  }
  v.setUint32(508, spec.magicEnd ?? UF2_MAGIC_END, true);
  return b;
}
