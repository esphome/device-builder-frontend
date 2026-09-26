import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchEsphomeWebManifest,
  type FirmwareManifest,
  resetEsphomeWebManifest,
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
  resetEsphomeWebManifest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

  it("fetches once per page, so every dialog open shares it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(MANIFEST), { status: 200 }))
    );
    const [first, second] = await Promise.all([
      fetchEsphomeWebManifest(),
      fetchEsphomeWebManifest(),
    ]);
    expect(await fetchEsphomeWebManifest()).toBe(first);
    expect(second).toBe(first);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("drops a failed fetch, so Retry fetches again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(MANIFEST), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchEsphomeWebManifest()).rejects.toThrow(/503/);
    expect((await fetchEsphomeWebManifest()).version).toBe("26.5.1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
