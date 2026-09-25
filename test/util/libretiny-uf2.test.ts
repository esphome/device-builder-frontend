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
    expect(image.firmware).toBe("esphome");
    expect(image.version).toBe("2026.10.0-dev");
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

  it("restarts a run when a later group lands on a known offset", () => {
    const uf2 = makeLibreTinyUf2({
      blocks: [
        { addr: 0x0, fill: 0x11, tags: info(BOOT_INFO) },
        { addr: 0x100, fill: 0x12 },
        { addr: 0x0, fill: 0x21, tags: info(BOOT_INFO) },
      ],
    });
    const runs = parse(uf2).runs;
    expect(runs).toHaveLength(1);
    expect(runs[0].data.length).toBe(256);
    expect(runs[0].data[0]).toBe(0x21);
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

  it("rejects a page past the end of its partition", () => {
    const uf2 = makeLibreTinyUf2({
      blocks: [{ addr: 0x8000, tags: info(BOOT_INFO) }],
    });
    expect(() => parse(uf2)).toThrow(/past 'boot'/);
  });

  it("rejects a file with nothing to flash", () => {
    const uf2 = makeLibreTinyUf2({ blocks: [{ addr: 0, payload: 0 } as never] });
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

  it("rejects a block whose count disagrees with the file", () => {
    const one = makeUf2Block({ addr: 0, numBlocks: 3, family: UF2_FAMILY_AMBZ2 });
    expect(() => parseLibreTinyBlocks(one)).toThrow(/block count/);
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
