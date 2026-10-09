import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BW16_PARTITIONS,
  ltHeaderTags,
  ltPartInfoTags,
  ltPartitionTable,
  makeLibreTinyUf2,
} from "../../_make-libretiny-uf2.js";
import {
  AMBD_PARSE,
  parseAmbdImage,
  UF2_FAMILY_AMBD,
} from "../../../src/platforms/rtl87xx/ambd-image.js";
import { UF2_FAMILY_AMBZ2 } from "../../../src/platforms/rtl87xx/ambz2-image.js";
import { makeAmbdUf2, OTA1_OFFSET, OTA2_OFFSET } from "./_fake-ambd.js";

const UF2 = makeAmbdUf2();
const bw16Tags = () =>
  ltHeaderTags({ BOARD: "bw16", FAL_PTABLE: ltPartitionTable(BW16_PARTITIONS) });

// A partition table with no second slot at all.
const NO_OTA2 = makeLibreTinyUf2({
  family: UF2_FAMILY_AMBD,
  headerTags: ltHeaderTags({
    BOARD: "bw16",
    FAL_PTABLE: ltPartitionTable([{ name: "ota1", offset: 0x6000, length: 0x1fa000 }]),
  }),
  blocks: [{ addr: 0, tags: ltPartInfoTags([0, 1, 0, 0, 1, 0], ["ota1"]) }],
});
// OTA_PART_INFO sends the flasher's first slot into ota2, whose head the flasher clears.
const IN_OTA2 = makeLibreTinyUf2({
  family: UF2_FAMILY_AMBD,
  headerTags: bw16Tags(),
  blocks: [{ addr: 0, tags: ltPartInfoTags([0, 1, 2, 0, 2, 2], ["ota1", "ota2"]) }],
});

afterEach(() => {
  vi.doUnmock("../../../src/platforms/rtl87xx/ambd-image.js");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("parseAmbdImage", () => {
  it("resolves the first slot on the sector grid and where the second lives", () => {
    const { image, ota2Offset } = parseAmbdImage(UF2);
    expect(image.familyId).toBe(UF2_FAMILY_AMBD);
    expect(image.board).toBe("bw16");
    expect(image.runs.map((r) => [r.address, r.data.length])).toEqual([
      [OTA1_OFFSET, 10 * 256 + 40],
    ]);
    expect(image.totalBytes).toBe(10 * 256 + 40);
    expect(ota2Offset).toBe(OTA2_OFFSET);
    expect(AMBD_PARSE).toEqual({
      scheme: "flasher-ota1",
      blockSize: 0x1000,
      blocksFrom: "flash",
    });
  });

  it("refuses a layout without a second slot", () => {
    expect(() => parseAmbdImage(NO_OTA2)).toThrow(/no 'ota2' partition/);
  });

  it("refuses a first slot that lands in the second", () => {
    expect(() => parseAmbdImage(IN_OTA2)).toThrow(/overlaps the 'ota2' partition/);
  });

  it("names a build for another Realtek chip as the wrong family", () => {
    const ambz2 = makeLibreTinyUf2({
      family: UF2_FAMILY_AMBZ2,
      blocks: [{ addr: 0, tags: ltPartInfoTags([0, 1, 2, 0, 1, 2], ["ota1", "ota2"]) }],
    });
    expect(() => parseAmbdImage(ambz2)).toThrow(
      expect.objectContaining({ key: "firmware.rtl_wrong_family" })
    );
    expect(() => parseAmbdImage(new Uint8Array(512))).toThrow(
      expect.objectContaining({ key: "firmware.rtl_bad_uf2" })
    );
  });
});

describe("loadAmbdImage / checkAmbdImage", () => {
  const load = async () => import("../../../src/platforms/rtl87xx/index.js");

  it("parse the file through the on-demand chunk without throwing", async () => {
    const { loadAmbdImage, checkAmbdImage } = await load();
    expect(await loadAmbdImage(UF2)).toMatchObject({
      image: { ota2Offset: OTA2_OFFSET, image: { runs: [{ address: OTA1_OFFSET }] } },
    });
    expect(await checkAmbdImage(UF2)).toMatchObject({ file: { board: "bw16" } });
    expect(await checkAmbdImage(NO_OTA2)).toMatchObject({ key: "firmware.rtl_bad_uf2" });
    expect(await loadAmbdImage(new Uint8Array(512))).toMatchObject({
      key: "firmware.rtl_bad_uf2",
    });
  });

  it("name a parser chunk that did not load, instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("../../../src/platforms/rtl87xx/ambd-image.js", () => {
      throw new TypeError("Failed to fetch");
    });
    const { loadAmbdImage } = await load();
    expect(await loadAmbdImage(UF2)).toMatchObject({
      key: "firmware.engine_load_failed",
    });
  });
});
