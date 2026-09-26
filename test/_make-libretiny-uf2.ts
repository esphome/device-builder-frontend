import {
  LT_TAG,
  PARTITION_ENTRY_SIZE,
  PARTITION_MAGIC,
  UF2_FAMILY_AMBZ2,
} from "../src/platforms/rtl87xx/libretiny-uf2.js";
/** Builders for LibreTiny-flavoured UF2 files (tags, partition table, part info). */
import { concat } from "../src/util/bytes.js";
import { UF2_FLAG_NOT_MAIN_FLASH } from "../src/util/uf2.js";
import { makeUf2Block, type Uf2Tag } from "./_make-uf2-block.js";

const enc = new TextEncoder();

export const ltTag = (type: number, data: Uint8Array | string): Uf2Tag => ({
  type,
  data: typeof data === "string" ? enc.encode(data) : data,
});

export interface LtPartitionSpec {
  name: string;
  offset: number;
  length: number;
}

/** The bw15 layout the flasher's scheme resolves against. */
export const BW15_PARTITIONS: LtPartitionSpec[] = [
  { name: "part_table", offset: 0x0, length: 0x1000 },
  { name: "boot", offset: 0x4000, length: 0x8000 },
  { name: "ota1", offset: 0xc000, length: 0xf8000 },
  { name: "ota2", offset: 0x104000, length: 0xf8000 },
];

export function ltPartitionTable(parts: LtPartitionSpec[]): Uint8Array {
  const table = new Uint8Array(parts.length * PARTITION_ENTRY_SIZE);
  const v = new DataView(table.buffer);
  parts.forEach((p, i) => {
    const off = i * PARTITION_ENTRY_SIZE;
    v.setUint32(off, PARTITION_MAGIC, true);
    table.set(enc.encode(p.name), off + 4);
    table.set(enc.encode(p.name), off + 20);
    v.setUint32(off + 36, p.offset, true);
    v.setUint32(off + 40, p.length, true);
  });
  return table;
}

/** OTA_PART_INFO: one partition index (1-based, 0 = none) per scheme, then the names. */
export function ltPartInfo(indexes: number[], names: string[]): Uint8Array {
  const digits = indexes.map((i) => i.toString(16)).join("");
  const head = new Uint8Array(3);
  for (let i = 0; i < 3; i++) head[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
  return concat(head, enc.encode(names.map((n) => `${n}\0`).join("")));
}

export interface LtBlockSpec {
  addr: number;
  data?: Uint8Array;
  fill?: number;
  tags?: Uf2Tag[];
}

export interface LtUf2Spec {
  family?: number | null;
  headerTags?: Uf2Tag[];
  blocks: LtBlockSpec[];
}

/** The usual header tags, overridable per key. */
export function ltHeaderTags(
  over: Partial<Record<keyof typeof LT_TAG, string | null>> = {}
) {
  const tags: Uf2Tag[] = [];
  const add = (key: keyof typeof LT_TAG, fallback: Uint8Array | string) => {
    const value = over[key];
    if (value === null) return;
    tags.push(ltTag(LT_TAG[key], value ?? fallback));
  };
  add("BOARD", "bw15");
  add("OTA_FORMAT_2", new Uint8Array([2]));
  add("FAL_PTABLE", ltPartitionTable(BW15_PARTITIONS));
  return tags;
}

/** A whole file: a header block (no payload, not main flash) then the data blocks. */
export function makeLibreTinyUf2(spec: LtUf2Spec): Uint8Array<ArrayBuffer> {
  const family = spec.family === undefined ? UF2_FAMILY_AMBZ2 : spec.family;
  const numBlocks = spec.blocks.length + 1;
  const blocks = [
    makeUf2Block({
      addr: 0,
      blockNo: 0,
      numBlocks,
      family,
      payload: 0,
      flags: UF2_FLAG_NOT_MAIN_FLASH,
      tags: spec.headerTags ?? ltHeaderTags(),
    }),
    ...spec.blocks.map((b, i) =>
      makeUf2Block({
        addr: b.addr,
        blockNo: i + 1,
        numBlocks,
        family,
        data: b.data,
        fill: b.fill,
        tags: b.tags,
      })
    ),
  ];
  return concat(...blocks);
}
