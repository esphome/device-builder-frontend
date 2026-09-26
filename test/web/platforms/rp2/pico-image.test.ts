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
  picoUf2Url,
} from "../../../../src/web/platforms/rp2/pico-image.js";

const uf2Response = (family: number) => ({
  ok: true,
  arrayBuffer: async () => makeUf2Block({ addr: 0x10000000, family }).buffer,
});

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
    const loaded = await loadPicoImage();
    expect(fetch).toHaveBeenCalledWith(
      "https://firmware.esphome.io/esphome-web/26.5.1/esphome-web-rp2040.uf2"
    );
    expect(loaded.familyId).toBe(UF2_FAMILY_RP2040);
    expect(loaded.totalBytes).toBe(256);
  });

  it("names a failed download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 }))
    );
    await expect(loadPicoImage()).rejects.toThrow(
      /esphome-web-rp2040\.uf2 failed \(404\)/
    );
  });

  it("refuses another family", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => uf2Response(UF2_FAMILY_RP2350_ARM_S))
    );
    await expect(loadPicoImage()).rejects.toThrow(/family/);
  });
});

describe("picoUf2Url", () => {
  it("builds the versioned rp2040 UF2 url", () => {
    expect(picoUf2Url({ version: "26.5.1", builds: [] })).toBe(
      "https://firmware.esphome.io/esphome-web/26.5.1/esphome-web-rp2040.uf2"
    );
  });
});
