import { describe, expect, it } from "vitest";

import {
  BW15_PARTITIONS,
  ltBinpatchTag,
  ltHeaderTags,
  ltPartInfoTags,
  ltPartitionTable,
  ltTag,
  makeLibreTinyUf2,
} from "../_make-libretiny-uf2.js";
import { makeUf2Block } from "../_make-uf2-block.js";
import {
  LT_TAG,
  parseLibreTinyBlocks,
  parseLibreTinyImage,
  parsePartitionTable,
} from "../../src/platforms/libretiny-uf2.js";
import {
  AMBZ2_PARSE,
  UF2_FAMILY_AMBZ,
  UF2_FAMILY_AMBZ2,
} from "../../src/platforms/rtl87xx/ambz2-image.js";
import { Uf2FamilyError } from "../../src/util/uf2.js";

// Scheme slots: device single, device OTA1, device OTA2, flasher single,
// flasher OTA1, flasher OTA2.
const OTA_INFO = ltPartInfoTags([0, 1, 2, 0, 1, 2], ["ota1", "ota2"]);
const BOOT_INFO = ltPartInfoTags([0, 0, 0, 0, 1, 1], ["boot"]);
const OTA2_WIPE_INFO = ltPartInfoTags([0, 0, 0, 0, 2, 1], ["ota1", "ota2"]);

// As the RTL8720C flasher parses: the first OTA slot, blocks from the run.
const parse = (bytes: Uint8Array) =>
  parseLibreTinyImage(bytes, [UF2_FAMILY_AMBZ2], AMBZ2_PARSE);

describe("parseLibreTinyImage", () => {
  it("resolves the flasher's OTA1 runs through the file's partition table", () => {
    const uf2 = makeLibreTinyUf2({
      blocks: [
        { addr: 0x0, fill: 0xa1, tags: OTA_INFO },
        { addr: 0x100, fill: 0xa2 },
        { addr: 0x0, fill: 0xb1, tags: BOOT_INFO },
        { addr: 0x0, fill: 0xc1, tags: OTA2_WIPE_INFO },
      ],
    });
    const image = parse(uf2);
    expect(image.familyId).toBe(UF2_FAMILY_AMBZ2);
    expect(image.board).toBe("bw15");
    expect(image.runs.map((r) => [r.address, r.data.length])).toEqual([
      [0xc000, 512],
      [0x4000, 256],
      [0x104000, 256],
    ]);
    expect(image.runs[0].data[0]).toBe(0xa1);
    expect(image.runs[0].data[256]).toBe(0xa2);
    expect(image.runs[2].data[0]).toBe(0xc1);
    expect(image.totalBytes).toBe(1024);
  });

  it("skips groups the flasher scheme does not write (device-only data)", () => {
    const deviceOnly = ltPartInfoTags([1, 0, 0, 0, 0, 0], ["ota1"]);
    const uf2 = makeLibreTinyUf2({
      blocks: [
        { addr: 0x0, tags: deviceOnly },
        { addr: 0x0, fill: 0xb1, tags: BOOT_INFO },
      ],
    });
    expect(parse(uf2).runs.map((r) => r.address)).toEqual([0x4000]);
  });

  it("overwrites a run's first pages in place when a later group restarts it (the image header)", () => {
    const uf2 = makeLibreTinyUf2({
      blocks: [
        { addr: 0x0, fill: 0x11, tags: OTA_INFO },
        { addr: 0x100, fill: 0x12 },
        { addr: 0x200, fill: 0x13 },
        // The header, written last so a partial flash never looks bootable.
        { addr: 0x0, fill: 0x21, tags: OTA_INFO },
        { addr: 0x100, fill: 0x22 },
      ],
    });
    const runs = parse(uf2).runs;
    expect(runs).toHaveLength(1);
    expect(runs[0].address).toBe(0xc000);
    expect(runs[0].data.length).toBe(768);
    expect([runs[0].data[0], runs[0].data[0x100], runs[0].data[0x200]]).toEqual([
      0x21, 0x22, 0x13,
    ]);
  });

  it("keeps a header page on its own partition when the previous run fills up to it", () => {
    // boot is exactly four pages and ota1 starts right after it; the ota1
    // header group must open its own run, not continue boot's.
    const table = ltPartitionTable([
      { name: "boot", offset: 0x4000, length: 0x400 },
      { name: "ota1", offset: 0x4400, length: 0x1000 },
    ]);
    const uf2 = makeLibreTinyUf2({
      headerTags: [
        ltTag(LT_TAG.BOARD, "bw15"),
        ltTag(LT_TAG.OTA_FORMAT_2, new Uint8Array([2])),
        ltTag(LT_TAG.FAL_PTABLE, table),
      ],
      blocks: [
        { addr: 0x0, fill: 0xb1, tags: BOOT_INFO },
        { addr: 0x100, fill: 0xb2 },
        { addr: 0x200, fill: 0xb3 },
        { addr: 0x300, fill: 0xb4 },
        { addr: 0x0, fill: 0xa1, tags: ltPartInfoTags([0, 0, 0, 0, 1, 1], ["ota1"]) },
      ],
    });
    expect(parse(uf2).runs.map((r) => [r.address, r.data.length])).toEqual([
      [0x4000, 1024],
      [0x4400, 256],
    ]);
  });

  it("rejects a run that lands inside another run's written or padded range", () => {
    // The first ota1 page pads to 1 KiB; a page at 0x200 is neither its
    // start nor its cursor, so it opens a second run inside that block.
    const uf2 = makeLibreTinyUf2({
      blocks: [
        { addr: 0x0, fill: 0xa1, tags: OTA_INFO },
        { addr: 0x200, fill: 0xa2 },
      ],
    });
    expect(() => parse(uf2)).toThrow(/runs at 0xc000 and 0xc200 overlap in 'ota1'/);
  });

  it("rejects a run whose XModem padding would reach past its partition", () => {
    // boot ends at 0x8000; a page at 0x7F00 fits, but its 1 KiB block does not.
    const uf2 = makeLibreTinyUf2({
      blocks: [{ addr: 0x7f00, tags: BOOT_INFO }],
    });
    expect(() => parse(uf2)).toThrow(/pads past 'boot'/);
  });

  it("refuses another Realtek family, naming it", () => {
    const uf2 = makeLibreTinyUf2({
      family: UF2_FAMILY_AMBZ,
      blocks: [{ addr: 0, tags: BOOT_INFO }],
    });
    let err: unknown;
    try {
      parse(uf2);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Uf2FamilyError);
    expect((err as Uf2FamilyError).familyId).toBe(UF2_FAMILY_AMBZ);
  });

  it("refuses a file without a family id", () => {
    const uf2 = makeLibreTinyUf2({
      family: null,
      blocks: [{ addr: 0, tags: BOOT_INFO }],
    });
    expect(() => parse(uf2)).toThrow(Uf2FamilyError);
  });

  it.each([
    ["legacy format", { OTA_FORMAT_2: null }, /legacy/],
    ["no board name", { BOARD: null }, /no board/],
    ["no partition table", { FAL_PTABLE: null }, /no partition table/],
  ] as const)("rejects a header with %s", (_name, over, message) => {
    const uf2 = makeLibreTinyUf2({
      headerTags: ltHeaderTags(over),
      blocks: [{ addr: 0, tags: BOOT_INFO }],
    });
    expect(() => parse(uf2)).toThrow(message);
  });

  it("rejects a group naming a partition the table lacks", () => {
    const uf2 = makeLibreTinyUf2({
      blocks: [{ addr: 0, tags: ltPartInfoTags([0, 0, 0, 0, 1, 1], ["kvs"]) }],
    });
    expect(() => parse(uf2)).toThrow(/'kvs' not in table/);
  });

  it("rejects a page running past the end of its partition", () => {
    // boot is 0x8000 long; a 256-byte page at 0x7F80 ends 128 bytes past it.
    const uf2 = makeLibreTinyUf2({
      blocks: [{ addr: 0x7f80, tags: BOOT_INFO }],
    });
    expect(() => parse(uf2)).toThrow(/past 'boot'/);
  });

  it("rejects a data block that arrives before any part info", () => {
    const uf2 = makeLibreTinyUf2({ blocks: [{ addr: 0 }] });
    expect(() => parse(uf2)).toThrow(/before OTA_PART_INFO/);
  });

  it("rejects a file with nothing to flash", () => {
    const deviceOnly = ltPartInfoTags([1, 0, 0, 0, 0, 0], ["ota1"]);
    const uf2 = makeLibreTinyUf2({ blocks: [{ addr: 0, tags: deviceOnly }] });
    expect(() => parse(uf2)).toThrow(/nothing to flash/);
  });
});

describe("parseLibreTinyImage, the second OTA slot", () => {
  const word = (value: number) => {
    const data = new Uint8Array(256).fill(0x11);
    new DataView(data.buffer).setUint32(8, value, true);
    return data;
  };
  const uf2 = makeLibreTinyUf2({
    blocks: [
      {
        addr: 0x0,
        data: word(0x0800c000),
        tags: [...OTA_INFO, ltBinpatchTag(0x104000 - 0xc000, [8])],
      },
    ],
  });
  const parseAs = (scheme: "flasher-ota1" | "flasher-ota2") =>
    parseLibreTinyImage(uf2, [UF2_FAMILY_AMBZ2], { ...AMBZ2_PARSE, scheme });
  const word8 = (data: Uint8Array) => new DataView(data.buffer).getUint32(8, true);

  it("writes the first slot as it is", () => {
    const [run] = parseAs("flasher-ota1").runs;
    expect(run.address).toBe(0xc000);
    expect(word8(run.data)).toBe(0x0800c000);
  });

  it("writes the second slot with the block's BINPATCH applied", () => {
    const [run] = parseAs("flasher-ota2").runs;
    expect(run.address).toBe(0x104000);
    expect(word8(run.data)).toBe(0x08104000);
    expect(run.data[0]).toBe(0x11);
  });

  it("refuses the second slot of a file that carries no BINPATCH", () => {
    const plain = makeLibreTinyUf2({
      blocks: [{ addr: 0x0, data: word(0x0800c000), tags: OTA_INFO }],
    });
    const as = (scheme: "flasher-ota1" | "flasher-ota2") =>
      parseLibreTinyImage(plain, [UF2_FAMILY_AMBZ2], { ...AMBZ2_PARSE, scheme });
    expect(as("flasher-ota1").runs).toHaveLength(1);
    expect(() => as("flasher-ota2")).toThrow(/no BINPATCH for the second slot/);
  });

  it("refuses a BINPATCH whose offset is not word aligned", () => {
    const bad = makeLibreTinyUf2({
      blocks: [
        { addr: 0x0, data: word(0x0800c000), tags: [...OTA_INFO, ltBinpatchTag(4, [9])] },
      ],
    });
    expect(() =>
      parseLibreTinyImage(bad, [UF2_FAMILY_AMBZ2], {
        ...AMBZ2_PARSE,
        scheme: "flasher-ota2",
      })
    ).toThrow(/BINPATCH offset 9 not word aligned/);
  });

  it("refuses a BINPATCH that reaches past its block", () => {
    const bad = makeLibreTinyUf2({
      blocks: [{ addr: 0x0, tags: [...OTA_INFO, ltBinpatchTag(4, [254])] }],
    });
    expect(() =>
      parseLibreTinyImage(bad, [UF2_FAMILY_AMBZ2], {
        ...AMBZ2_PARSE,
        scheme: "flasher-ota2",
      })
    ).toThrow(/BINPATCH/);
  });

  it.each([
    ["an unknown opcode", [0x01, 4, 0, 0, 0, 0]],
    ["a DIFF32 without its delta", [0xfe, 2, 0, 0]],
    ["a DIFF32 with no offsets", [0xfe, 4, 0, 0, 0, 0]],
    ["a length past the tag", [0xfe, 9, 0, 0, 0, 0, 8]],
    ["a stray trailing byte", [0xfe, 5, 0, 0, 0, 0, 8, 0xfe]],
    ["nothing in it", []],
  ])("refuses a BINPATCH with %s instead of patching part of the slot", (_, bytes) => {
    const bad = makeLibreTinyUf2({
      blocks: [
        { addr: 0x0, tags: [...OTA_INFO, ltTag(LT_TAG.BINPATCH, new Uint8Array(bytes))] },
      ],
    });
    expect(() =>
      parseLibreTinyImage(bad, [UF2_FAMILY_AMBZ2], {
        ...AMBZ2_PARSE,
        scheme: "flasher-ota2",
      })
    ).toThrow(/Invalid UF2: .*BINPATCH/);
  });
});

describe("parseLibreTinyBlocks", () => {
  it("accepts the payload-less header block and reads its tags", () => {
    const uf2 = makeLibreTinyUf2({ blocks: [{ addr: 0, tags: BOOT_INFO }] });
    const blocks = parseLibreTinyBlocks(uf2);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].notMainFlash).toBe(true);
    expect(blocks[0].data.length).toBe(0);
    expect(new TextDecoder().decode(blocks[0].tags.get(LT_TAG.BOARD))).toBe("bw15");
    expect(blocks[1].tags.get(LT_TAG.OTA_PART_INFO)).toEqual(BOOT_INFO[0].data);
  });

  it("rejects a tag with an impossible size", () => {
    const short = makeLibreTinyUf2({ blocks: [{ addr: 0, tags: BOOT_INFO }] });
    short[32] = 2; // the header block's first tag claims less than its own header
    expect(() => parseLibreTinyBlocks(short)).toThrow(/malformed tag/);

    const past = makeLibreTinyUf2({ blocks: [{ addr: 0, tags: BOOT_INFO }] });
    past[32] = 0xff; // a 255-byte tag, then one at 256 that runs past the region
    past[32 + 256] = 0xff;
    expect(() => parseLibreTinyBlocks(past)).toThrow(/malformed tag/);
  });

  it("rejects a block whose count disagrees with the file", () => {
    const one = makeUf2Block({ addr: 0, numBlocks: 3, family: UF2_FAMILY_AMBZ2 });
    expect(() => parseLibreTinyBlocks(one)).toThrow(/claims 3 blocks, file has 1/);
  });
});

describe("parsePartitionTable", () => {
  it("reads name, offset and length per entry", () => {
    expect(parsePartitionTable(ltPartitionTable(BW15_PARTITIONS))).toEqual(
      BW15_PARTITIONS
    );
  });

  it("rejects a bad entry size or magic", () => {
    expect(() => parsePartitionTable(new Uint8Array(20))).toThrow(/20 bytes/);
    expect(() => parsePartitionTable(new Uint8Array(48))).toThrow(/bad magic/);
  });
});
