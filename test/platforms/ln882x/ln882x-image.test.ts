import { describe, expect, it } from "vitest";
import {
  ltHeaderTags,
  ltPartInfoTags,
  ltPartitionTable,
  makeLibreTinyUf2,
} from "../../_make-libretiny-uf2.js";
import {
  Ln882xImageError,
  parseLn882xImage,
  UF2_FAMILY_LN882H,
} from "../../../src/platforms/ln882x/ln882x-image.js";

// The generic-ln882h layout from LibreTiny's board definition.
const PARTITIONS = [
  { name: "boot", offset: 0x0, length: 0x6000 },
  { name: "part_table", offset: 0x6000, length: 0x1000 },
  { name: "app", offset: 0x7000, length: 0x12c000 },
  { name: "ota", offset: 0x133000, length: 0xaa000 },
];

// One partition for the flasher's single scheme, none for the device's OTA.
const flasher = (name: string) => ltPartInfoTags([0, 0, 0, 1, 0, 0], [name]);
const device = (name: string) => ltPartInfoTags([1, 0, 0, 0, 0, 0], [name]);

const file = (family: number | null = UF2_FAMILY_LN882H) =>
  makeLibreTinyUf2({
    family,
    headerTags: ltHeaderTags({
      BOARD: "generic-ln882h",
      FAL_PTABLE: ltPartitionTable(PARTITIONS),
    }),
    blocks: [
      { addr: 0, fill: 0x11, tags: flasher("boot") },
      { addr: 0, fill: 0x22, tags: flasher("part_table") },
      { addr: 0, fill: 0x33, tags: flasher("app") },
      { addr: 0x100, fill: 0x34 },
      { addr: 0, fill: 0x44, tags: device("ota") },
    ],
  });

describe("parseLn882xImage", () => {
  it("takes the bootloader, partition table and app, not the device's own update", () => {
    const image = parseLn882xImage(file());

    expect(image.familyId).toBe(UF2_FAMILY_LN882H);
    expect(image.board).toBe("generic-ln882h");
    expect(image.runs.map((r) => [r.address, r.data.length])).toEqual([
      [0x0, 256],
      [0x6000, 256],
      [0x7000, 512],
    ]);
    expect(image.runs[2].data[0]).toBe(0x33);
    expect(image.runs[2].data[256]).toBe(0x34);
  });

  it("names a build for another chip", () => {
    const parse = () => parseLn882xImage(file(0xe08f7564));

    expect(parse).toThrow(Ln882xImageError);
    try {
      parse();
    } catch (err) {
      expect((err as Ln882xImageError).key).toBe("firmware.ln_wrong_family");
    }
  });

  it("calls anything else a bad file", () => {
    try {
      parseLn882xImage(new Uint8Array(100));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Ln882xImageError);
      expect((err as Ln882xImageError).key).toBe("firmware.ln_bad_uf2");
    }
  });
});
