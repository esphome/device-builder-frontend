import { afterEach, describe, expect, it, vi } from "vitest";
import { ltPartInfoTags, makeLibreTinyUf2 } from "../../_make-libretiny-uf2.js";
import { fixtureUf2 } from "./_fake-ambz.js";

const AMBZ = await fixtureUf2();
const AMBZ2 = makeLibreTinyUf2({
  blocks: [
    { addr: 0x0, fill: 0xa1, tags: ltPartInfoTags([0, 1, 2, 0, 1, 2], ["ota1", "ota2"]) },
  ],
});

afterEach(() => {
  vi.doUnmock("../../../src/platforms/libretiny-uf2.js");
  vi.doUnmock("../../../src/platforms/rtl87xx/ambz-image.js");
  vi.resetModules();
  vi.restoreAllMocks();
});

const load = async () =>
  (await import("../../../src/platforms/rtl87xx/index.js")).loadRtl87xxImage;

describe("loadRtl87xxImage", () => {
  it("names each Realtek chip from its build", async () => {
    const loadRtl87xxImage = await load();
    expect(await loadRtl87xxImage(AMBZ2)).toMatchObject({
      image: { chip: "ambz2", image: { runs: [{ address: 0xc000 }] } },
    });
    expect(await loadRtl87xxImage(AMBZ)).toMatchObject({
      image: { chip: "ambz", image: { ota2Offset: 0x80000 } },
    });
  });

  it("reads the file once, whichever chip it is for", async () => {
    const calls = vi.fn();
    vi.doMock("../../../src/platforms/libretiny-uf2.js", async (importOriginal) => {
      const real =
        await importOriginal<typeof import("../../../src/platforms/libretiny-uf2.js")>();
      return {
        ...real,
        parseLibreTinyFile: (...args: Parameters<typeof real.parseLibreTinyFile>) => {
          calls();
          return real.parseLibreTinyFile(...args);
        },
      };
    });
    const loadRtl87xxImage = await load();
    await loadRtl87xxImage(AMBZ);
    await loadRtl87xxImage(AMBZ2);
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("refuses another family and a file that is not a UF2", async () => {
    const loadRtl87xxImage = await load();
    const bk = makeLibreTinyUf2({ family: 0x675a40b0, blocks: [{ addr: 0x0 }] });
    expect(await loadRtl87xxImage(bk)).toMatchObject({
      key: "firmware.rtl_wrong_family",
    });
    expect(await loadRtl87xxImage(new Uint8Array(512))).toMatchObject({
      key: "firmware.rtl_bad_uf2",
    });
  });

  it("names a parser chunk that did not load, instead of throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("../../../src/platforms/rtl87xx/ambz-image.js", () => {
      throw new TypeError("Failed to fetch");
    });
    const loadRtl87xxImage = await load();
    expect(await loadRtl87xxImage(AMBZ)).toMatchObject({
      key: "firmware.engine_load_failed",
    });
  });
});
