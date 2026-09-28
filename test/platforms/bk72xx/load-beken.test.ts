import { afterEach, describe, expect, it, vi } from "vitest";
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
      BekenUnknownFlashError: class extends Error {},
      flashBeken: vi.fn().mockRejectedValue(new Error("no answer")),
    }));
    const { runBeken } = await import("../../../src/platforms/bk72xx/index.js");

    expect(await runBeken(PORT, IMAGE, HOOKS)).toMatchObject({
      key: undefined,
      detail: "no answer",
    });
  });

  it("says so when the flash went through", async () => {
    const flashBeken = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../../../src/platforms/bk72xx/beken-flasher.js", () => ({ flashBeken }));
    const { runBeken } = await import("../../../src/platforms/bk72xx/index.js");

    expect(await runBeken(PORT, IMAGE, HOOKS)).toEqual({ rebooted: true });
    expect(flashBeken).toHaveBeenCalledWith(PORT, IMAGE, HOOKS);
  });
});
