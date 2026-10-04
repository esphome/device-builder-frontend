import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibreTinyImage } from "../../../src/platforms/libretiny-uf2.js";

const IMAGE: LibreTinyImage = { familyId: 0, board: "b", runs: [], totalBytes: 0 };
const PORT = {} as SerialPort;
const HOOKS = { onProgress: () => {} };

afterEach(() => {
  vi.doUnmock("../../../src/platforms/ln882x/ln882x-image.js");
  vi.doUnmock("../../../src/platforms/ln882x/ln882x-flasher.js");
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("loadLn882xImage", () => {
  it("names a parser chunk that did not load, instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("../../../src/platforms/ln882x/ln882x-image.js", () => {
      throw new TypeError("Failed to fetch");
    });
    const { loadLn882xImage } = await import("../../../src/platforms/ln882x/index.js");

    expect(await loadLn882xImage(new Uint8Array(512))).toMatchObject({
      key: "firmware.engine_load_failed",
    });
  });

  it("names a file that is not a UF2", async () => {
    const { loadLn882xImage } = await import("../../../src/platforms/ln882x/index.js");

    expect(await loadLn882xImage(new Uint8Array(512))).toMatchObject({
      key: "firmware.ln_bad_uf2",
    });
  });

  it("names a failure of the parser that is not its own as a bad UF2", async () => {
    vi.doMock("../../../src/platforms/ln882x/ln882x-image.js", () => ({
      Ln882xImageError: class extends Error {},
      parseLn882xImage: () => {
        throw new RangeError("out of memory");
      },
    }));
    const { loadLn882xImage } = await import("../../../src/platforms/ln882x/index.js");

    expect(await loadLn882xImage(new Uint8Array(512))).toEqual({
      key: "firmware.ln_bad_uf2",
      detail: "out of memory",
    });
  });
});

describe("runLn882x", () => {
  it("names an engine chunk that did not load, instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("../../../src/platforms/ln882x/ln882x-flasher.js", () => {
      throw new TypeError("Failed to fetch");
    });
    const { runLn882x } = await import("../../../src/platforms/ln882x/index.js");

    expect(await runLn882x(PORT, IMAGE, HOOKS)).toMatchObject({
      key: "firmware.engine_load_failed",
      error: expect.any(Error),
    });
  });

  it("names a failure of the flash that has no copy of its own by its detail alone", async () => {
    vi.doMock("../../../src/platforms/ln882x/ln882x-flasher.js", () => ({
      Ln882xRamcodeError: class extends Error {},
      flashLn882x: vi.fn().mockRejectedValue(new Error("no answer")),
    }));
    const { runLn882x } = await import("../../../src/platforms/ln882x/index.js");

    const result = await runLn882x(PORT, IMAGE, HOOKS);
    expect(result).toMatchObject({ detail: "no answer" });
    expect(result).not.toHaveProperty("key");
  });

  it("names a RAM code that could not be had by its own copy", async () => {
    class Ln882xRamcodeError extends Error {
      key = "firmware.ln_ramcode_mismatch";
    }
    vi.doMock("../../../src/platforms/ln882x/ln882x-flasher.js", () => ({
      Ln882xRamcodeError,
      flashLn882x: vi.fn().mockRejectedValue(new Ln882xRamcodeError("bad hash")),
    }));
    const { runLn882x } = await import("../../../src/platforms/ln882x/index.js");

    expect(await runLn882x(PORT, IMAGE, HOOKS)).toMatchObject({
      key: "firmware.ln_ramcode_mismatch",
      detail: "bad hash",
    });
  });

  it("passes on whether the chip was rebooted", async () => {
    const flashLn882x = vi.fn().mockResolvedValue(false);
    vi.doMock("../../../src/platforms/ln882x/ln882x-flasher.js", () => ({
      Ln882xRamcodeError: class extends Error {},
      flashLn882x,
    }));
    const { runLn882x } = await import("../../../src/platforms/ln882x/index.js");

    expect(await runLn882x(PORT, IMAGE, HOOKS)).toEqual({ rebooted: false });
    expect(flashLn882x).toHaveBeenCalledWith(PORT, IMAGE, HOOKS);
  });
});
