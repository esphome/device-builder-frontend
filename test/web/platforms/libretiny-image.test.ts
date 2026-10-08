import { afterEach, describe, expect, it, vi } from "vitest";

import {
  linkedImage,
  LinkedImageError,
} from "../../../src/web/platforms/libretiny-image.js";
import {
  PublishedImageUnavailableError,
  resetEsphomeWebManifest,
} from "../../../src/web/util/esphome-web-firmware.js";

// The deadline every UF2 download is given.
const SIGNAL = { signal: expect.any(AbortSignal) };

const MANIFEST = {
  version: "26.10.0",
  builds: [{ chipFamily: "BK7251", parts: [] }],
};
const UF2 = new Uint8Array([1, 2, 3]);
const IMAGE = { runs: [] };

afterEach(() => {
  resetEsphomeWebManifest();
  vi.unstubAllGlobals();
});

describe("linkedImage", () => {
  it("parses the published image of the linked chip's family", async () => {
    const fetch = vi.fn(async () => ({ ok: true, arrayBuffer: async () => UF2.buffer }));
    vi.stubGlobal("fetch", fetch);
    const load = vi.fn(async () => ({ image: IMAGE }));

    const image = await linkedImage(load, MANIFEST, { chip: "BK7252", family: "BK7251" });

    expect(image).toBe(IMAGE);
    expect(load).toHaveBeenCalledWith(UF2);
    expect(fetch).toHaveBeenCalledWith(
      "https://firmware.esphome.io/esphome-web/26.10.0/esphome-web-bk7251.uf2",
      SIGNAL
    );
  });

  it.each([
    [{ chip: "BK7231Q", family: "BK7231Q" }, "BK7231Q"],
    [{ chip: undefined, family: undefined }, undefined],
  ])("names the chip of a family with no image (%o)", async (linked, label) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const err = await linkedImage(vi.fn(), MANIFEST, linked).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PublishedImageUnavailableError);
    expect((err as PublishedImageUnavailableError).label).toBe(label);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails with the parser's copy and reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => UF2.buffer }))
    );
    const load = async () => ({ key: "firmware.bk_bad_uf2", detail: "no blocks" });

    const err = await linkedImage(load, MANIFEST, {
      chip: "BK7252",
      family: "BK7251",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LinkedImageError);
    expect(err).toMatchObject({ key: "firmware.bk_bad_uf2", message: "no blocks" });
  });

  it("names a failed download as such, without parsing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503 }))
    );
    const load = vi.fn();

    const err = await linkedImage(load, MANIFEST, {
      chip: "BK7252",
      family: "BK7251",
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LinkedImageError);
    expect(err).toMatchObject({
      key: "web.install.prebuilt_download_failed",
      message: expect.stringMatching(/failed \(503\)/),
    });
    expect(load).not.toHaveBeenCalled();
  });
});
