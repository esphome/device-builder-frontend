import { afterEach, describe, expect, it, vi } from "vitest";

import {
  downloadBuildParts,
  fetchEsphomeWebManifest,
  type FirmwareManifest,
  picoUf2Url,
  selectBuild,
} from "../../src/web/util/esphome-web-firmware.js";

const MANIFEST: FirmwareManifest = {
  version: "26.5.1",
  builds: [
    { chipFamily: "ESP32", parts: [{ path: "26.5.1/esp32.factory.bin", offset: 0 }] },
    {
      chipFamily: "ESP32-C3",
      parts: [{ path: "26.5.1/esp32c3.factory.bin", offset: 0 }],
    },
  ],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("selectBuild", () => {
  it("matches a chip family case-insensitively", () => {
    expect(selectBuild(MANIFEST, "ESP32-C3")?.chipFamily).toBe("ESP32-C3");
    expect(selectBuild(MANIFEST, "esp32-c3")?.chipFamily).toBe("ESP32-C3");
    expect(selectBuild(MANIFEST, "ESP32")?.chipFamily).toBe("ESP32");
  });

  it("returns undefined for an unlisted chip", () => {
    expect(selectBuild(MANIFEST, "ESP32-H2")).toBeUndefined();
  });
});

describe("picoUf2Url", () => {
  it("builds the versioned rp2040 UF2 url", () => {
    expect(picoUf2Url(MANIFEST)).toBe(
      "https://firmware.esphome.io/esphome-web/26.5.1/esphome-web-rp2040.uf2"
    );
  });
});

describe("fetchEsphomeWebManifest", () => {
  it("fetches and parses the manifest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(MANIFEST), { status: 200 }))
    );
    const manifest = await fetchEsphomeWebManifest();
    expect(manifest.version).toBe("26.5.1");
    expect(fetch).toHaveBeenCalledWith(
      "https://firmware.esphome.io/esphome-web/manifest.json"
    );
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 }))
    );
    await expect(fetchEsphomeWebManifest()).rejects.toThrow(/404/);
  });
});

describe("downloadBuildParts", () => {
  it("downloads each part into byte arrays at its offset", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes, { status: 200 }))
    );
    const parts = await downloadBuildParts({
      chipFamily: "ESP32",
      parts: [{ path: "26.5.1/esp32.factory.bin", offset: 0 }],
    });
    expect(parts).toHaveLength(1);
    expect(parts[0].address).toBe(0);
    expect(Array.from(parts[0].data)).toEqual([1, 2, 3, 4]);
    expect(fetch).toHaveBeenCalledWith(
      "https://firmware.esphome.io/esphome-web/26.5.1/esp32.factory.bin"
    );
  });

  it("throws when a part download fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 500 }))
    );
    await expect(
      downloadBuildParts({
        chipFamily: "ESP32",
        parts: [{ path: "x.bin", offset: 0 }],
      })
    ).rejects.toThrow(/500/);
  });
});
