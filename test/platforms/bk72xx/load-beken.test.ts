import { afterEach, describe, expect, it, vi } from "vitest";
import { makeLibreTinyUf2 } from "../../_make-libretiny-uf2.js";
import { BEKEN_FAMILIES } from "../../../src/platforms/bk72xx/beken-chips.js";
import type { LibreTinyImage } from "../../../src/platforms/libretiny-uf2.js";

const IMAGE: LibreTinyImage = { familyId: 0, board: "b", runs: [], totalBytes: 0 };
const PORT = {} as SerialPort;
const HOOKS = { onProgress: () => {} };

afterEach(() => {
  vi.doUnmock("../../../src/platforms/bk72xx/beken-image.js");
  vi.doUnmock("../../../src/platforms/bk72xx/beken-flasher.js");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("loadBekenImage", () => {
  it("names a parser chunk that did not load, instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("../../../src/platforms/bk72xx/beken-image.js", () => {
      throw new TypeError("Failed to fetch");
    });
    const { loadBekenImage } = await import("../../../src/platforms/bk72xx/index.js");

    expect(await loadBekenImage(new Uint8Array(512))).toMatchObject({
      key: "firmware.engine_load_failed",
    });
  });

  it("names a file that is not a UF2", async () => {
    const { loadBekenImage } = await import("../../../src/platforms/bk72xx/index.js");

    expect(await loadBekenImage(new Uint8Array(512))).toMatchObject({
      key: "firmware.bk_bad_uf2",
    });
  });

  it("names a failure of the parser that is not its own as a bad UF2", async () => {
    vi.doMock("../../../src/platforms/bk72xx/beken-image.js", () => ({
      BekenImageError: class extends Error {},
      parseBekenImage: () => {
        throw new RangeError("out of memory");
      },
    }));
    const { loadBekenImage } = await import("../../../src/platforms/bk72xx/index.js");

    expect(await loadBekenImage(new Uint8Array(512))).toEqual({
      key: "firmware.bk_bad_uf2",
      detail: "out of memory",
    });
  });
});

describe("checkBekenImage", () => {
  it("reads the header of a build, or names what is wrong with it", async () => {
    const { checkBekenImage } = await import("../../../src/platforms/bk72xx/index.js");
    const { id } = BEKEN_FAMILIES[0];

    expect(
      await checkBekenImage(makeLibreTinyUf2({ family: id, blocks: [{ addr: 0 }] }))
    ).toMatchObject({
      file: { familyId: id, board: "bw15" },
    });
    expect(
      await checkBekenImage(makeLibreTinyUf2({ blocks: [{ addr: 0 }] }))
    ).toMatchObject({
      key: "firmware.bk_wrong_family",
    });
    expect(await checkBekenImage(new Uint8Array(512))).toMatchObject({
      key: "firmware.bk_bad_uf2",
    });
  });
});

describe("runBeken", () => {
  it("names an engine chunk that did not load, instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("../../../src/platforms/bk72xx/beken-flasher.js", () => {
      throw new TypeError("Failed to fetch");
    });
    const { runBeken } = await import("../../../src/platforms/bk72xx/index.js");

    expect(await runBeken(PORT, IMAGE, HOOKS)).toMatchObject({
      key: "firmware.engine_load_failed",
      error: expect.any(Error),
    });
  });

  it("names a failure of the flash that has no copy of its own by its detail alone", async () => {
    vi.doMock("../../../src/platforms/bk72xx/beken-flasher.js", () => ({
      BekenChipMismatchError: class extends Error {},
      BekenNoBootloaderError: class extends Error {},
      BekenUnknownFlashError: class extends Error {},
      flashBeken: vi.fn().mockRejectedValue(new Error("no answer")),
    }));
    const { runBeken } = await import("../../../src/platforms/bk72xx/index.js");

    const failed = await runBeken(PORT, IMAGE, HOOKS);
    expect(failed).toMatchObject({ detail: "no answer" });
    expect(failed).not.toHaveProperty("key");
  });

  it("names a chip without a bootloader by its own copy", async () => {
    class BekenNoBootloaderError extends Error {}
    vi.doMock("../../../src/platforms/bk72xx/beken-flasher.js", () => ({
      BekenChipMismatchError: class extends Error {},
      BekenNoBootloaderError,
      BekenUnknownFlashError: class extends Error {},
      flashBeken: vi.fn().mockRejectedValue(new BekenNoBootloaderError("blank")),
    }));
    const { runBeken } = await import("../../../src/platforms/bk72xx/index.js");

    expect(await runBeken(PORT, IMAGE, HOOKS)).toMatchObject({
      key: "firmware.bk_no_bootloader",
      detail: "blank",
    });
  });

  it("says so when the flash went through", async () => {
    const flashBeken = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../../../src/platforms/bk72xx/beken-flasher.js", () => ({ flashBeken }));
    const { runBeken } = await import("../../../src/platforms/bk72xx/index.js");

    expect(await runBeken(PORT, IMAGE, HOOKS)).toEqual({ rebooted: true });
    expect(flashBeken).toHaveBeenCalledWith(PORT, IMAGE, HOOKS);
  });

  it("hands a source of the image to the engine, and a source's failure back as the flash's", async () => {
    const unavailable = new Error("No ESPHome Web image for the BK7231Q");
    const flashBeken = vi.fn(
      async (_port, source: (linked: object) => Promise<unknown>) => {
        await source({ chip: "BK7231Q", family: "BK7231Q" });
      }
    );
    vi.doMock("../../../src/platforms/bk72xx/beken-flasher.js", () => ({
      BekenChipMismatchError: class extends Error {},
      BekenNoBootloaderError: class extends Error {},
      BekenUnknownFlashError: class extends Error {},
      flashBeken,
    }));
    const { runBeken } = await import("../../../src/platforms/bk72xx/index.js");
    const source = vi.fn().mockRejectedValue(unavailable);

    const failed = await runBeken(PORT, source, HOOKS);

    expect(flashBeken).toHaveBeenCalledWith(PORT, source, HOOKS);
    expect(source).toHaveBeenCalledWith({ chip: "BK7231Q", family: "BK7231Q" });
    expect(failed).toEqual({ detail: unavailable.message, error: unavailable });
  });
});
