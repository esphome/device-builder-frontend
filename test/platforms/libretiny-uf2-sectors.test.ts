import { describe, expect, it } from "vitest";
import {
  ltPartInfoTags as info,
  ltHeaderTags,
  type LtPartitionSpec,
  ltPartitionTable,
  makeLibreTinyUf2,
} from "../_make-libretiny-uf2.js";
import {
  type LibreTinyParseOptions,
  parseLibreTinyImage,
} from "../../src/platforms/libretiny-uf2.js";

const FAMILY = 0x7b3ef230;

// The layout of a Tuya BK7231N module.
const PARTITIONS = [
  { name: "app", offset: 0x11000, length: 0x119000 },
  { name: "download", offset: 0x12a000, length: 0xa6000 },
];

const header = (parts: LtPartitionSpec[] = PARTITIONS) =>
  ltHeaderTags({ BOARD: "cb3s", FAL_PTABLE: ltPartitionTable(parts) });

// As the build writes them: the app for the flasher's single scheme and the
// device's first slot, the download partition for the device alone.
const APP = info([0, 0, 0, 1, 0, 0], ["app"]);
const DOWNLOAD = info([1, 0, 0, 0, 0, 0], ["download"]);

const parse = (bytes: Uint8Array, over: Partial<LibreTinyParseOptions> = {}) =>
  parseLibreTinyImage(bytes, [FAMILY], {
    scheme: "flasher-single",
    blockSize: 4096,
    blocksFrom: "flash",
    ...over,
  });

describe("parseLibreTinyImage, by scheme", () => {
  const file = () =>
    makeLibreTinyUf2({
      family: FAMILY,
      headerTags: header(),
      blocks: [
        { addr: 0x0, fill: 0xa1, tags: APP },
        { addr: 0x100, fill: 0xa2 },
        { addr: 0x0, fill: 0xd1, tags: DOWNLOAD },
      ],
    });

  it("takes the partition of the flasher's single scheme", () => {
    const image = parse(file());

    expect(image.board).toBe("cb3s");
    expect(image.familyId).toBe(FAMILY);
    expect(image.runs.map((r) => r.address)).toEqual([0x11000]);
    expect(image.totalBytes).toBe(512);
    expect(image.runs[0].data[0]).toBe(0xa1);
    expect(image.runs[0].data[256]).toBe(0xa2);
  });

  it("finds nothing under a scheme the file has no partition for", () => {
    expect(() => parse(file(), { scheme: "flasher-ota1" })).toThrow(/nothing to flash/);
  });

  it("reads the two schemes from their own digit", () => {
    const both = makeLibreTinyUf2({
      family: FAMILY,
      headerTags: header(),
      blocks: [
        { addr: 0x0, fill: 0x01, tags: info([0, 0, 0, 1, 2, 0], ["app", "download"]) },
      ],
    });

    expect(parse(both).runs[0].address).toBe(0x11000);
    expect(parse(both, { scheme: "flasher-ota1" }).runs[0].address).toBe(0x12a000);
  });
});

describe("parseLibreTinyImage, by where the blocks lie", () => {
  const run = (addr: number, length = 102) =>
    makeLibreTinyUf2({
      family: FAMILY,
      headerTags: header(),
      blocks: [{ addr, data: new Uint8Array(length).fill(0x5a), tags: APP }],
    });
  const fromRun = { blocksFrom: "run", blockSize: 1024 } as const;

  // The small run a build puts at the end of the app partition.
  const TAIL = 0x119000 - 0xf6;

  it("takes a run in the last sector of its partition on the grid of the flash", () => {
    const image = parse(run(TAIL));

    expect(image.runs[0].address).toBe(0x11000 + TAIL);
    expect(image.runs[0].data).toHaveLength(102);
  });

  it("refuses that run for blocks that start at the run", () => {
    expect(() => parse(run(TAIL), fromRun)).toThrow(/pads past 'app'/);
  });

  it("refuses a run whose last sector reaches past its partition", () => {
    const odd = [{ name: "app", offset: 0x11000, length: 0x800 }];
    const file = makeLibreTinyUf2({
      family: FAMILY,
      headerTags: header(odd),
      blocks: [{ addr: 0, fill: 0x01, tags: APP }],
    });

    expect(() => parse(file)).toThrow(/pads past 'app'/);
    expect(() => parse(file, fromRun)).not.toThrow();
  });

  it("refuses a run whose first sector starts before its partition", () => {
    const odd = [{ name: "app", offset: 0x11800, length: 0x2000 }];
    const file = makeLibreTinyUf2({
      family: FAMILY,
      headerTags: header(odd),
      blocks: [{ addr: 0, fill: 0x01, tags: APP }],
    });

    expect(() => parse(file)).toThrow(/pads past 'app'/);
  });

  it("refuses two runs that share a sector", () => {
    const close = makeLibreTinyUf2({
      family: FAMILY,
      headerTags: header(),
      blocks: [
        { addr: 0x0, fill: 0x01, tags: APP },
        { addr: 0x800, fill: 0x02 },
      ],
    });

    expect(() => parse(close)).toThrow(/overlap in 'app'/);
    expect(() => parse(close, fromRun)).not.toThrow();
  });

  it("takes two runs in sectors next to each other", () => {
    const apart = makeLibreTinyUf2({
      family: FAMILY,
      headerTags: header(),
      blocks: [
        { addr: 0x0, fill: 0x01, tags: APP },
        { addr: 0x1f00, fill: 0x02 },
      ],
    });

    expect(parse(apart).runs.map((r) => r.address)).toEqual([0x11000, 0x12f00]);
  });
});
