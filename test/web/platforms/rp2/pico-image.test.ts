import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetchEsphomeWebManifest: vi.fn() }));
vi.mock("../../../../src/web/util/esphome-web-firmware.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchEsphomeWebManifest: mocks.fetchEsphomeWebManifest,
}));

import { makeUf2Block } from "../../../_make-uf2-block.js";
import { UF2_FAMILY_RP2040, UF2_FAMILY_RP2350_ARM_S } from "../../../../src/util/uf2.js";
import {
  loadPicoImage,
  picoImageChips,
  PicoImageUnavailableError,
  picoUf2Url,
} from "../../../../src/web/platforms/rp2/pico-image.js";

const uf2Response = (family: number) => ({
  ok: true,
  arrayBuffer: async () => makeUf2Block({ addr: 0x10000000, family }).buffer,
});

const withRp2350 = {
  version: "26.5.1",
  builds: [
    { chipFamily: "RP2040", parts: [] },
    { chipFamily: "RP2350", parts: [] },
  ],
};

beforeEach(() => {
  mocks.fetchEsphomeWebManifest.mockResolvedValue({ version: "26.5.1", builds: [] });
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("loadPicoImage", () => {
  it("fetches the manifest's UF2 and parses it as an RP2040 image", async () => {
    const fetch = vi.fn(async () => uf2Response(UF2_FAMILY_RP2040));
    vi.stubGlobal("fetch", fetch);
    const loaded = await loadPicoImage("rp2040");
    expect(fetch).toHaveBeenCalledWith(
      "https://firmware.esphome.io/esphome-web/26.5.1/esphome-web-rp2040.uf2"
    );
    expect(loaded.familyId).toBe(UF2_FAMILY_RP2040);
    expect(loaded.totalBytes).toBe(256);
  });

  it("fetches the RP2350 UF2 when the manifest lists an RP2350 build", async () => {
    mocks.fetchEsphomeWebManifest.mockResolvedValue(withRp2350);
    const fetch = vi.fn(async () => uf2Response(UF2_FAMILY_RP2350_ARM_S));
    vi.stubGlobal("fetch", fetch);
    const loaded = await loadPicoImage("rp2350");
    expect(fetch).toHaveBeenCalledWith(
      "https://firmware.esphome.io/esphome-web/26.5.1/esphome-web-rp2350.uf2"
    );
    expect(loaded.familyId).toBe(UF2_FAMILY_RP2350_ARM_S);
  });

  it("names a chip the manifest has no image for, without downloading", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const err = await loadPicoImage("rp2350").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PicoImageUnavailableError);
    expect((err as PicoImageUnavailableError).chip).toBe("rp2350");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("names a failed download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 }))
    );
    await expect(loadPicoImage("rp2040")).rejects.toThrow(
      /esphome-web-rp2040\.uf2 failed \(404\)/
    );
  });

  it("refuses another family", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => uf2Response(UF2_FAMILY_RP2350_ARM_S))
    );
    await expect(loadPicoImage("rp2040")).rejects.toThrow(/family/);
  });
});

describe("picoImageChips", () => {
  it("offers the RP2040 alone until the manifest lists an RP2350 build", () => {
    expect(picoImageChips({ version: "26.5.1", builds: [] })).toEqual(["rp2040"]);
    expect(picoImageChips(withRp2350)).toEqual(["rp2040", "rp2350"]);
  });
});

describe("picoUf2Url", () => {
  it("builds the versioned UF2 url for the chip", () => {
    expect(picoUf2Url({ version: "26.5.1", builds: [] }, "rp2040")).toBe(
      "https://firmware.esphome.io/esphome-web/26.5.1/esphome-web-rp2040.uf2"
    );
    expect(picoUf2Url({ version: "26.5.1", builds: [] }, "rp2350")).toBe(
      "https://firmware.esphome.io/esphome-web/26.5.1/esphome-web-rp2350.uf2"
    );
  });
});
