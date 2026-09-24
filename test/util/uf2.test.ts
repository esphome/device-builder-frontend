import { describe, expect, it } from "vitest";

import {
  blocksToRanges,
  parseUf2Blocks,
  parseUf2Image,
  UF2_FAMILY_RP2040,
  UF2_FAMILY_RP2350_ARM_S,
  UF2_FLAG_FAMILY_ID_PRESENT,
  UF2_FLAG_NOT_MAIN_FLASH,
  UF2_MAGIC_END,
  UF2_MAGIC_START0,
  UF2_MAGIC_START1,
  Uf2FamilyError,
} from "../../src/util/uf2.js";

interface BlockSpec {
  addr: number;
  blockNo: number;
  numBlocks: number;
  family?: number | null;
  fill?: number;
  flags?: number;
  payload?: number;
  magicEnd?: number;
}

function block(spec: BlockSpec): Uint8Array {
  const b = new Uint8Array(512);
  const v = new DataView(b.buffer);
  const family = spec.family === undefined ? UF2_FAMILY_RP2040 : spec.family;
  const flags = (spec.flags ?? 0) | (family === null ? 0 : UF2_FLAG_FAMILY_ID_PRESENT);
  v.setUint32(0, UF2_MAGIC_START0, true);
  v.setUint32(4, UF2_MAGIC_START1, true);
  v.setUint32(8, flags, true);
  v.setUint32(12, spec.addr, true);
  v.setUint32(16, spec.payload ?? 256, true);
  v.setUint32(20, spec.blockNo, true);
  v.setUint32(24, spec.numBlocks, true);
  if (family !== null) v.setUint32(28, family, true);
  b.fill(spec.fill ?? spec.blockNo + 1, 32, 32 + (spec.payload ?? 256));
  v.setUint32(508, spec.magicEnd ?? UF2_MAGIC_END, true);
  return b;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
};

const BASE = 0x10000000;

describe("parseUf2Blocks", () => {
  it("reads the header fields and the payload", () => {
    const [b] = parseUf2Blocks(block({ addr: BASE, blockNo: 0, numBlocks: 1 }));
    expect(b.targetAddr).toBe(BASE);
    expect(b.familyId).toBe(UF2_FAMILY_RP2040);
    expect(b.data.length).toBe(256);
    expect(b.data[0]).toBe(1);
  });

  it("reports a missing family id as null", () => {
    const [b] = parseUf2Blocks(
      block({ addr: BASE, blockNo: 0, numBlocks: 1, family: null })
    );
    expect(b.familyId).toBeNull();
  });

  it("skips blocks flagged as not main flash", () => {
    const bytes = concat(
      block({
        addr: 0x20000000,
        blockNo: 0,
        numBlocks: 2,
        flags: UF2_FLAG_NOT_MAIN_FLASH,
      }),
      block({ addr: BASE, blockNo: 1, numBlocks: 2 })
    );
    expect(parseUf2Blocks(bytes).map((b) => b.targetAddr)).toEqual([BASE]);
  });

  it("rejects a length that is not a multiple of 512", () => {
    expect(() => parseUf2Blocks(new Uint8Array(500))).toThrow(/multiple of 512/);
    expect(() => parseUf2Blocks(new Uint8Array(0))).toThrow(/multiple of 512/);
  });

  it("rejects bad magics", () => {
    const bad = block({ addr: BASE, blockNo: 0, numBlocks: 1, magicEnd: 0 });
    expect(() => parseUf2Blocks(bad)).toThrow(/bad magic in block 0/);
    const notUf2 = new Uint8Array(512);
    expect(() => parseUf2Blocks(notUf2)).toThrow(/bad magic/);
  });

  it("rejects a block count that disagrees with the file", () => {
    expect(() => parseUf2Blocks(block({ addr: BASE, blockNo: 0, numBlocks: 3 }))).toThrow(
      /claims 3 blocks, file has 1/
    );
  });

  it("rejects an impossible payload size", () => {
    expect(() =>
      parseUf2Blocks(block({ addr: BASE, blockNo: 0, numBlocks: 1, payload: 480 }))
    ).toThrow(/payload size 480/);
  });
});

describe("blocksToRanges", () => {
  it("merges contiguous pages into one range in address order", () => {
    const blocks = parseUf2Blocks(
      concat(
        block({ addr: BASE + 256, blockNo: 1, numBlocks: 2 }),
        block({ addr: BASE, blockNo: 0, numBlocks: 2 })
      )
    );
    const ranges = blocksToRanges(blocks);
    expect(ranges).toHaveLength(1);
    expect(ranges[0].address).toBe(BASE);
    expect(ranges[0].data.length).toBe(512);
    expect(ranges[0].data[0]).toBe(1);
    expect(ranges[0].data[256]).toBe(2);
  });

  it("splits at a gap", () => {
    const blocks = parseUf2Blocks(
      concat(
        block({ addr: BASE, blockNo: 0, numBlocks: 2 }),
        block({ addr: BASE + 0x1000, blockNo: 1, numBlocks: 2 })
      )
    );
    expect(blocksToRanges(blocks).map((r) => r.address)).toEqual([BASE, BASE + 0x1000]);
  });

  it("rejects overlapping pages", () => {
    const blocks = parseUf2Blocks(
      concat(
        block({ addr: BASE, blockNo: 0, numBlocks: 2 }),
        block({ addr: BASE + 128, blockNo: 1, numBlocks: 2 })
      )
    );
    expect(() => blocksToRanges(blocks)).toThrow(/overlapping/);
  });
});

describe("parseUf2Image", () => {
  it("accepts an RP2040 image and totals its bytes", () => {
    const image = parseUf2Image(
      concat(
        block({ addr: BASE, blockNo: 0, numBlocks: 2 }),
        block({ addr: BASE + 256, blockNo: 1, numBlocks: 2 })
      ),
      [UF2_FAMILY_RP2040]
    );
    expect(image.familyId).toBe(UF2_FAMILY_RP2040);
    expect(image.totalBytes).toBe(512);
    expect(image.ranges).toHaveLength(1);
  });

  it("refuses an RP2350 image with the family in the error", () => {
    const bytes = block({
      addr: BASE,
      blockNo: 0,
      numBlocks: 1,
      family: UF2_FAMILY_RP2350_ARM_S,
    });
    let caught: unknown;
    try {
      parseUf2Image(bytes, [UF2_FAMILY_RP2040]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Uf2FamilyError);
    expect((caught as Uf2FamilyError).familyId).toBe(UF2_FAMILY_RP2350_ARM_S);
    expect((caught as Error).message).toContain("0xe48bff59");
  });

  it("refuses an image without a family id", () => {
    expect(() =>
      parseUf2Image(block({ addr: BASE, blockNo: 0, numBlocks: 1, family: null }), [
        UF2_FAMILY_RP2040,
      ])
    ).toThrow(Uf2FamilyError);
  });

  it("refuses mixed families", () => {
    const bytes = concat(
      block({ addr: BASE, blockNo: 0, numBlocks: 2 }),
      block({
        addr: BASE + 256,
        blockNo: 1,
        numBlocks: 2,
        family: UF2_FAMILY_RP2350_ARM_S,
      })
    );
    expect(() => parseUf2Image(bytes, [UF2_FAMILY_RP2040])).toThrow(
      /different chip families/
    );
  });

  it("refuses a file with only non-flash blocks", () => {
    const bytes = block({
      addr: 0x20000000,
      blockNo: 0,
      numBlocks: 1,
      flags: UF2_FLAG_NOT_MAIN_FLASH,
    });
    expect(() => parseUf2Image(bytes, [UF2_FAMILY_RP2040])).toThrow(/no flash blocks/);
  });
});
