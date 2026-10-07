import { afterEach, describe, expect, it, vi } from "vitest";
import { ltPartInfoTags, makeLibreTinyUf2 } from "../../_make-libretiny-uf2.js";
import { UF2_FAMILY_AMBZ } from "../../../src/platforms/rtl87xx/ambz2-image.js";

const ambz2 = (family?: number) =>
  makeLibreTinyUf2({
    family,
    blocks: [{ addr: 0, tags: ltPartInfoTags([0, 1, 2, 0, 1, 2], ["ota1", "ota2"]) }],
  });

afterEach(() => {
  vi.doUnmock("../../../src/platforms/rtl87xx/ambz2-image.js");
  vi.doUnmock("../../../src/platforms/rtl87xx/ambz2-flasher.js");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("loadAmbz2Image", () => {
  it("names a parser chunk that did not load, instead of throwing", async () => {
    vi.doMock("../../../src/platforms/rtl87xx/ambz2-image.js", () => {
      throw new TypeError("Failed to fetch");
    });
    const { loadAmbz2Image } = await import("../../../src/platforms/rtl87xx/index.js");
    expect(await loadAmbz2Image(new Uint8Array(512))).toMatchObject({
      key: "firmware.engine_load_failed",
    });
  });

  it("names a file that is not a UF2", async () => {
    const { loadAmbz2Image } = await import("../../../src/platforms/rtl87xx/index.js");
    expect(await loadAmbz2Image(new Uint8Array(512))).toMatchObject({
      key: "firmware.rtl_bad_uf2",
    });
  });
});

describe("checkAmbz2Image", () => {
  it("names a parser chunk that did not load, instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("../../../src/platforms/rtl87xx/ambz2-image.js", () => {
      throw new TypeError("Failed to fetch");
    });
    const { checkAmbz2Image } = await import("../../../src/platforms/rtl87xx/index.js");
    expect(await checkAmbz2Image(ambz2())).toMatchObject({
      key: "firmware.engine_load_failed",
    });
  });

  it("reads the header of a build, or names what is wrong with it", async () => {
    const { checkAmbz2Image } = await import("../../../src/platforms/rtl87xx/index.js");
    expect(await checkAmbz2Image(ambz2())).toMatchObject({ file: { board: "bw15" } });
    expect(await checkAmbz2Image(ambz2(UF2_FAMILY_AMBZ))).toMatchObject({
      key: "firmware.rtl_wrong_family",
    });
    expect(await checkAmbz2Image(new Uint8Array(512))).toMatchObject({
      key: "firmware.rtl_bad_uf2",
    });
  });
});

describe("runAmbz2", () => {
  const image = { familyId: 0, board: "b", runs: [], totalBytes: 0 };
  const hooks = { onProgress: () => {} };

  it("names an engine chunk that did not load, instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("../../../src/platforms/rtl87xx/ambz2-flasher.js", () => {
      throw new TypeError("Failed to fetch");
    });
    const { runAmbz2 } = await import("../../../src/platforms/rtl87xx/index.js");

    expect(await runAmbz2({} as SerialPort, image, hooks)).toMatchObject({
      key: "firmware.engine_load_failed",
      error: expect.any(Error),
    });
  });

  it("names a failure of the flash by its detail alone, and says whether the board rebooted", async () => {
    const flashAmbz2 = vi.fn().mockRejectedValueOnce(new Error("no answer"));
    vi.doMock("../../../src/platforms/rtl87xx/ambz2-flasher.js", () => ({ flashAmbz2 }));
    const { runAmbz2 } = await import("../../../src/platforms/rtl87xx/index.js");

    const failed = await runAmbz2({} as SerialPort, image, hooks);
    expect(failed).toMatchObject({ detail: "no answer" });
    expect("key" in failed).toBe(false);

    flashAmbz2.mockResolvedValue(false);
    expect(await runAmbz2({} as SerialPort, image, hooks)).toEqual({ rebooted: false });
  });
});
