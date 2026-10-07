import { afterEach, describe, expect, it, vi } from "vitest";
import { flashWith, parseWith } from "../../src/platforms/lazy-chunk.js";

const chunk = { double: (n: number) => n * 2 };
const loads = () => Promise.resolve(chunk);
const fails = () => Promise.reject(new TypeError("Failed to fetch"));
const key = () => "fam.bad" as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseWith", () => {
  it("names a chunk that could not be fetched and logs it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await parseWith("[fam]", fails, () => ({ image: 1 }), key);
    expect(result).toEqual({
      key: "firmware.engine_load_failed",
      detail: "Failed to fetch",
    });
    expect(error).toHaveBeenCalledWith(
      "[fam] Could not load the parser chunk:",
      expect.any(TypeError)
    );
  });

  it("names what the parse threw through keyOf, given the chunk", async () => {
    const boom = new RangeError("out of memory");
    const keyOf = vi.fn(key);
    const result = await parseWith(
      "[fam]",
      loads,
      () => {
        throw boom;
      },
      keyOf
    );
    expect(result).toEqual({ key: "fam.bad", detail: "out of memory" });
    expect(keyOf).toHaveBeenCalledWith(chunk, boom);
  });

  it("returns a sync parse as is", async () => {
    const result = await parseWith("[fam]", loads, (c) => ({ image: c.double(2) }), key);
    expect(result).toEqual({ image: 4 });
  });

  it("awaits an async parse", async () => {
    const parse = async (c: typeof chunk) => ({ image: c.double(3) });
    expect(await parseWith("[fam]", loads, parse, key)).toEqual({ image: 6 });
  });

  it("stringifies a thrown non-Error", async () => {
    const parse = () => {
      throw "boom";
    };
    expect(await parseWith("[fam]", loads, parse, key)).toEqual({
      key: "fam.bad",
      detail: "boom",
    });
  });
});

describe("flashWith", () => {
  const none = () => ({});

  it("names a chunk that could not be fetched and logs it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await flashWith("[fam]", fails, () => ({ rebooted: true }), none);
    expect(result).toEqual({
      detail: "Failed to fetch",
      error: expect.any(TypeError),
      key: "firmware.engine_load_failed",
    });
    expect(error).toHaveBeenCalledWith(
      "[fam] Could not load the engine chunk:",
      expect.any(TypeError)
    );
  });

  it("comes back as the detail and the error, with the keyed fields", async () => {
    const boom = new Error("no answer");
    const keyed = vi.fn(() => ({ key: "fam.x" }));
    const flash = () => Promise.reject(boom);
    const result = await flashWith("[fam]", loads, flash, keyed);
    expect(result).toEqual({ detail: "no answer", error: boom, key: "fam.x" });
    expect(keyed).toHaveBeenCalledWith(chunk, boom);
  });

  it("adds no key when the family names none", async () => {
    const flash = () => Promise.reject(new Error("no answer"));
    const result = await flashWith("[fam]", loads, flash, none);
    expect(result).toMatchObject({ detail: "no answer" });
    expect("key" in result).toBe(false);
  });

  it("keeps a key the family left undefined", async () => {
    const flash = () => Promise.reject(new Error("no answer"));
    const result = await flashWith("[fam]", loads, flash, () => ({ key: undefined }));
    expect(result).toHaveProperty("key", undefined);
  });

  it("returns the flash result as is", async () => {
    const flash = async () => ({ rebooted: false });
    expect(await flashWith("[fam]", loads, flash, none)).toEqual({ rebooted: false });
  });
});
