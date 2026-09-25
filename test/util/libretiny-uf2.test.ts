import { describe, expect, it } from "vitest";

import {
  BW15_PARTITIONS,
  ltHeaderTags,
  ltPartInfo,
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
  UF2_FAMILY_AMBZ,
  UF2_FAMILY_AMBZ2,
} from "../../src/util/libretiny-uf2.js";
import { Uf2FamilyError } from "../../src/util/uf2.js";

// Scheme slots: device single, device OTA1, device OTA2, flasher single,
// flasher OTA1, flasher OTA2.
const OTA_INFO = ltPartInfo([0, 1, 2, 0, 1, 2], ["ota1", "ota2"]);
const BOOT_INFO = ltPartInfo([0, 0, 0, 0, 1, 1], ["boot"]);
const OTA2_WIPE_INFO = ltPartInfo([0, 0, 0, 0, 2, 1], ["ota1", "ota2"]);
const info = (bytes: Uint8Array) => [ltTag(LT_TAG.OTA_PART_INFO, bytes)];

const parse = (bytes: Uint8Array) => parseLibreTinyImage(bytes, [UF2_FAMILY_AMBZ2]);

describe("parseLibreTinyImage", () => {
  it("resolves the flasher's OTA1 runs through the file's partition table", () => {
    const uf2 = makeLibreTinyUf2({
      blocks: [
        { addr: 0x0, fill: 0xa1, tags: info(OTA_INFO) },
        { addr: 0x100, fill: 0xa2 },
        { addr: 0x0, fill: 0xb1, tags: info(BOOT_INFO) },
        { addr: 0x0, fill: 0xc1, tags: info(OTA2_WIPE_INFO) },
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
    const deviceOnly = ltPartInfo([1, 0, 0, 0, 0, 0], ["ota1"]);
    const uf2 = makeLibreTinyUf2({
      blocks: [
        { addr: 0x0, tags: info(deviceOnly) },
        { addr: 0x0, fill: 0xb1, tags: info(BOOT_INFO) },
      ],
    });
    expect(parse(uf2).runs.map((r) => r.address)).toEqual([0x4000]);
  });

  it("overwrites a run's first pages in place when a later group restarts it (the image header)", () => {
    const uf2 = makeLibreTinyUf2({
      blocks: [
        { addr: 0x0, fill: 0x11, tags: info(OTA_INFO) },
        { addr: 0x100, fill: 0x12 },
        { addr: 0x200, fill: 0x13 },
        // The header, written last so a partial flash never looks bootable.
        { addr: 0x0, fill: 0x21, tags: info(OTA_INFO) },
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
        { addr: 0x0, fill: 0xb1, tags: info(BOOT_INFO) },
        { addr: 0x100, fill: 0xb2 },
        { addr: 0x200, fill: 0xb3 },
        { addr: 0x300, fill: 0xb4 },
        { addr: 0x0, fill: 0xa1, tags: info(ltPartInfo([0, 0, 0, 0, 1, 1], ["ota1"])) },
      ],
    });
    expect(parse(uf2).runs.map((r) => [r.address, r.data.length])).toEqual([
      [0x4000, 1024],
      [0x4400, 256],
    ]);
  });

  it("rejects a run whose XModem padding would reach past its partition", () => {
    // boot ends at 0x8000; a page at 0x7F00 fits, but its 1 KiB block does not.
    const uf2 = makeLibreTinyUf2({
      blocks: [{ addr: 0x7f00, tags: info(BOOT_INFO) }],
    });
    expect(() => parse(uf2)).toThrow(/pads past 'boot'/);
  });

  it("refuses another Realtek family, naming it", () => {
    const uf2 = makeLibreTinyUf2({
      family: UF2_FAMILY_AMBZ,
      blocks: [{ addr: 0, tags: info(BOOT_INFO) }],
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
      blocks: [{ addr: 0, tags: info(BOOT_INFO) }],
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
      blocks: [{ addr: 0, tags: info(BOOT_INFO) }],
    });
    expect(() => parse(uf2)).toThrow(message);
  });

  it("rejects a group naming a partition the table lacks", () => {
    const uf2 = makeLibreTinyUf2({
      blocks: [{ addr: 0, tags: info(ltPartInfo([0, 0, 0, 0, 1, 1], ["kvs"])) }],
    });
    expect(() => parse(uf2)).toThrow(/'kvs' not in table/);
  });

  it("rejects a page running past the end of its partition", () => {
    // boot is 0x8000 long; a 256-byte page at 0x7F80 ends 128 bytes past it.
    const uf2 = makeLibreTinyUf2({
      blocks: [{ addr: 0x7f80, tags: info(BOOT_INFO) }],
    });
    expect(() => parse(uf2)).toThrow(/past 'boot'/);
  });

  it("rejects a data block that arrives before any part info", () => {
    const uf2 = makeLibreTinyUf2({ blocks: [{ addr: 0 }] });
    expect(() => parse(uf2)).toThrow(/before OTA_PART_INFO/);
  });

  it("rejects a file with nothing to flash", () => {
    const deviceOnly = ltPartInfo([1, 0, 0, 0, 0, 0], ["ota1"]);
    const uf2 = makeLibreTinyUf2({ blocks: [{ addr: 0, tags: info(deviceOnly) }] });
    expect(() => parse(uf2)).toThrow(/nothing to flash/);
  });
});

describe("parseLibreTinyBlocks", () => {
  it("accepts the payload-less header block and reads its tags", () => {
    const uf2 = makeLibreTinyUf2({ blocks: [{ addr: 0, tags: info(BOOT_INFO) }] });
    const blocks = parseLibreTinyBlocks(uf2);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].notMainFlash).toBe(true);
    expect(blocks[0].data.length).toBe(0);
    expect(new TextDecoder().decode(blocks[0].tags.get(LT_TAG.BOARD))).toBe("bw15");
    expect(blocks[1].tags.get(LT_TAG.OTA_PART_INFO)).toEqual(BOOT_INFO);
  });

  it("rejects a tag with an impossible size", () => {
    const short = makeLibreTinyUf2({ blocks: [{ addr: 0, tags: info(BOOT_INFO) }] });
    short[32] = 2; // the header block's first tag claims less than its own header
    expect(() => parseLibreTinyBlocks(short)).toThrow(/malformed tag/);

    const past = makeLibreTinyUf2({ blocks: [{ addr: 0, tags: info(BOOT_INFO) }] });
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
