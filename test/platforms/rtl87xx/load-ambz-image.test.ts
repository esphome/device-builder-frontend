import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AMBZ2_OTA_TAGS,
  ltBinpatchTag,
  ltHeaderTags,
  ltPartInfoTags,
  ltPartitionTable,
  makeLibreTinyUf2,
} from "../../_make-libretiny-uf2.js";
import { parseAmbzImage } from "../../../src/platforms/rtl87xx/ambz-image.js";
import { UF2_FAMILY_AMBZ } from "../../../src/platforms/rtl87xx/ambz2-image.js";
import { fixtureUf2 } from "./_fake-ambz.js";

const UF2 = await fixtureUf2();

// OTA_PART_INFO sends the flasher's second slot to ota1 as well.
const MISPLACED = makeLibreTinyUf2({
  family: UF2_FAMILY_AMBZ,
  blocks: [
    {
      addr: 0,
      tags: [
        ...ltPartInfoTags([0, 1, 2, 0, 1, 1], ["ota1", "ota2"]),
        ltBinpatchTag(0, [8]),
      ],
    },
  ],
});
// A partition table with no second slot at all.
const NO_OTA2 = makeLibreTinyUf2({
  family: UF2_FAMILY_AMBZ,
  headerTags: ltHeaderTags({
    FAL_PTABLE: ltPartitionTable([{ name: "ota1", offset: 0xb000, length: 0x75000 }]),
  }),
  blocks: [{ addr: 0, tags: ltPartInfoTags([0, 1, 0, 0, 1, 0], ["ota1"]) }],
});

afterEach(() => {
  vi.doUnmock("../../../src/platforms/libretiny-uf2.js");
  vi.doUnmock("../../../src/platforms/rtl87xx/ambz-image.js");
  vi.doUnmock("../../../src/platforms/rtl87xx/ambz-flasher.js");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("parseAmbzImage", () => {
  it("resolves both OTA slots and where the second lives", () => {
    const image = parseAmbzImage(UF2);
    expect(image.ota1.familyId).toBe(UF2_FAMILY_AMBZ);
    expect(image.ota1.board).toBe("bw12");
    expect(image.ota1.runs.map((r) => r.address)).toEqual([0xb000]);
    expect(image.ota2.runs.map((r) => r.address)).toEqual([0x80000]);
    expect(image.ota2Offset).toBe(0x80000);
    // The second slot is the first, relocated by the file's BINPATCH.
    const word = (data: Uint8Array) => new DataView(data.buffer).getUint32(0, true);
    expect(word(image.ota2.runs[0].data) - word(image.ota1.runs[0].data)).toBe(
      0x80000 - 0xb000
    );
  });

  it("refuses a build for another Realtek chip as the wrong family", () => {
    const ambz2 = makeLibreTinyUf2({ blocks: [{ addr: 0, tags: AMBZ2_OTA_TAGS }] });
    expect(() => parseAmbzImage(ambz2)).toThrow(
      expect.objectContaining({ key: "firmware.rtl_wrong_family" })
    );
  });

  it("refuses a build whose second slot is not the 'ota2' partition", () => {
    expect(() => parseAmbzImage(MISPLACED)).toThrow(
      expect.objectContaining({ key: "firmware.rtl_bad_uf2" })
    );
  });

  it("refuses a file that is not a UF2", () => {
    expect(() => parseAmbzImage(new Uint8Array(512))).toThrow(
      expect.objectContaining({ key: "firmware.rtl_bad_uf2" })
    );
  });
});

describe("loadAmbzImage", () => {
  it("names a parser chunk that did not load, instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("../../../src/platforms/rtl87xx/ambz-image.js", () => {
      throw new TypeError("Failed to fetch");
    });
    const { loadAmbzImage } = await import("../../../src/platforms/rtl87xx/index.js");
    expect(await loadAmbzImage(UF2)).toMatchObject({
      key: "firmware.engine_load_failed",
    });
  });

  it("parses the build, or names what is wrong with it", async () => {
    const { loadAmbzImage } = await import("../../../src/platforms/rtl87xx/index.js");
    expect(await loadAmbzImage(UF2)).toHaveProperty("image.ota2Offset", 0x80000);
    expect(await loadAmbzImage(new Uint8Array(512))).toMatchObject({
      key: "firmware.rtl_bad_uf2",
    });
  });
});

describe("checkAmbzImage", () => {
  const load = () => import("../../../src/platforms/rtl87xx/index.js");

  it("reads the header of a build, or names what is wrong with it", async () => {
    const { checkAmbzImage } = await load();
    expect(await checkAmbzImage(UF2)).toMatchObject({
      file: { familyId: UF2_FAMILY_AMBZ, board: "bw12" },
    });
    expect(await checkAmbzImage(makeLibreTinyUf2({ blocks: [] }))).toMatchObject({
      key: "firmware.rtl_wrong_family",
    });
    expect(await checkAmbzImage(new Uint8Array(512))).toMatchObject({
      key: "firmware.rtl_bad_uf2",
    });
  });

  it("refuses a build whose table has no 'ota2' partition", async () => {
    const { checkAmbzImage } = await load();
    expect(await checkAmbzImage(NO_OTA2)).toMatchObject({
      key: "firmware.rtl_bad_uf2",
      detail: expect.stringContaining("ota2"),
    });
  });

  it("leaves a misplaced second slot to the full parse", async () => {
    const { checkAmbzImage } = await load();
    expect(await checkAmbzImage(MISPLACED)).toMatchObject({
      file: { familyId: UF2_FAMILY_AMBZ },
    });
  });

  it("builds neither slot, where the full parse builds both", async () => {
    const builds = vi.fn();
    vi.doMock("../../../src/platforms/libretiny-uf2.js", async (importOriginal) => {
      const real =
        await importOriginal<typeof import("../../../src/platforms/libretiny-uf2.js")>();
      return {
        ...real,
        libreTinyImageFor: (...args: Parameters<typeof real.libreTinyImageFor>) => {
          builds();
          return real.libreTinyImageFor(...args);
        },
      };
    });
    const { checkAmbzImage, loadAmbzImage } = await load();
    expect(await checkAmbzImage(UF2)).toMatchObject({ file: { board: "bw12" } });
    expect(builds).not.toHaveBeenCalled();
    await loadAmbzImage(UF2);
    expect(builds).toHaveBeenCalledTimes(2);
  });
});

describe("runAmbz", () => {
  const image = parseAmbzImage(UF2);
  const hooks = { onProgress: () => {} };

  it("names an engine chunk that did not load, instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("../../../src/platforms/rtl87xx/ambz-flasher.js", () => {
      throw new TypeError("Failed to fetch");
    });
    const { runAmbz } = await import("../../../src/platforms/rtl87xx/index.js");
    expect(await runAmbz({} as SerialPort, image, hooks)).toMatchObject({
      key: "firmware.engine_load_failed",
      error: expect.any(Error),
    });
  });

  it("names a failure of the flash by its detail alone", async () => {
    const flashAmbz = vi.fn().mockRejectedValueOnce(new Error("no answer"));
    vi.doMock("../../../src/platforms/rtl87xx/ambz-flasher.js", () => ({ flashAmbz }));
    const { runAmbz } = await import("../../../src/platforms/rtl87xx/index.js");
    const failed = await runAmbz({} as SerialPort, image, hooks);
    expect(failed).toMatchObject({ detail: "no answer" });
    expect("key" in failed).toBe(false);
    flashAmbz.mockResolvedValue(undefined);
    expect(await runAmbz({} as SerialPort, image, hooks)).toEqual({ rebooted: false });
  });
});
