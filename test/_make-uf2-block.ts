import {
  UF2_FAMILY_RP2040,
  UF2_FLAG_FAMILY_ID_PRESENT,
  UF2_MAGIC_END,
  UF2_MAGIC_START0,
  UF2_MAGIC_START1,
} from "../src/util/uf2.js";

export interface Uf2BlockSpec {
  addr: number;
  blockNo?: number;
  numBlocks?: number;
  /** ``null`` omits the family id entirely. Defaults to RP2040. */
  family?: number | null;
  fill?: number;
  flags?: number;
  payload?: number;
  magicEnd?: number;
}

/** One 512-byte UF2 block with a 256-byte payload of ``fill`` (default blockNo + 1). */
export function makeUf2Block(spec: Uf2BlockSpec): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(512);
  const v = new DataView(b.buffer);
  const blockNo = spec.blockNo ?? 0;
  const family = spec.family === undefined ? UF2_FAMILY_RP2040 : spec.family;
  const flags = (spec.flags ?? 0) | (family === null ? 0 : UF2_FLAG_FAMILY_ID_PRESENT);
  v.setUint32(0, UF2_MAGIC_START0, true);
  v.setUint32(4, UF2_MAGIC_START1, true);
  v.setUint32(8, flags, true);
  v.setUint32(12, spec.addr, true);
  v.setUint32(16, spec.payload ?? 256, true);
  v.setUint32(20, blockNo, true);
  v.setUint32(24, spec.numBlocks ?? 1, true);
  if (family !== null) v.setUint32(28, family, true);
  b.fill(spec.fill ?? blockNo + 1, 32, 32 + (spec.payload ?? 256));
  v.setUint32(508, spec.magicEnd ?? UF2_MAGIC_END, true);
  return b;
}
