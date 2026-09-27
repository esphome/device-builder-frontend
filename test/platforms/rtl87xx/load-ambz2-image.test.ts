import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("../../../src/platforms/rtl87xx/libretiny-uf2.js");
  vi.resetModules();
});

describe("loadAmbz2Image", () => {
  it("names a parser chunk that did not load, instead of throwing", async () => {
    vi.doMock("../../../src/platforms/rtl87xx/libretiny-uf2.js", () => {
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
