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
      "https://firmware.esphome.io/esphome-web/manifest.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
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

  it("fetches a new one once the cached manifest has aged out", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(JSON.stringify(MANIFEST), { status: 200 }))
      );
      await fetchEsphomeWebManifest();
      vi.advanceTimersByTime(14 * 60 * 1000);
      await fetchEsphomeWebManifest();
      expect(fetch).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(2 * 60 * 1000);
      await fetchEsphomeWebManifest();
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
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
