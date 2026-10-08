import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchEsphomeWebManifest,
  fetchPublishedUf2,
  type FirmwareManifest,
  PublishedImageUnavailableError,
  publishedKeys,
  publishedUf2Url,
  resetEsphomeWebManifest,
  selectBuild,
  UF2_DOWNLOAD_TIMEOUT_MS,
} from "../../src/web/util/esphome-web-firmware.js";

// The deadline every UF2 download is given.
const SIGNAL = { signal: expect.any(AbortSignal) };

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

// The UF2 builds are listed without parts.
const UF2_MANIFEST: FirmwareManifest = {
  version: "26.10.0",
  builds: [
    { chipFamily: "BK7231N", parts: [] },
    { chipFamily: "LN882H", parts: [] },
    { chipFamily: "RTL8720C", parts: [] },
  ],
};
const uf2Response = (bytes: Uint8Array) => ({
  ok: true,
  arrayBuffer: async () => bytes.buffer,
});

describe("fetchPublishedUf2", () => {
  it("downloads the key's UF2 for the manifest's version", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetch = vi.fn(async () => uf2Response(bytes));
    vi.stubGlobal("fetch", fetch);

    expect(await fetchPublishedUf2(UF2_MANIFEST, "BK7231N")).toEqual(bytes);
    expect(fetch).toHaveBeenCalledWith(
      "https://firmware.esphome.io/esphome-web/26.10.0/esphome-web-bk7231n.uf2",
      SIGNAL
    );
  });

  it("names a key the manifest has no image for, without downloading", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const err = await fetchPublishedUf2(UF2_MANIFEST, "BK7238", "BK7238 chip").catch(
      (e: unknown) => e
    );

    expect(err).toBeInstanceOf(PublishedImageUnavailableError);
    expect(err).toMatchObject({ key: "BK7238", label: "BK7238 chip" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("downloads an image once, for every later fetch of it", async () => {
    const fetch = vi.fn(async () => uf2Response(new Uint8Array([1])));
    vi.stubGlobal("fetch", fetch);

    await fetchPublishedUf2(UF2_MANIFEST, "LN882H");
    await fetchPublishedUf2(UF2_MANIFEST, "LN882H");
    await fetchPublishedUf2(UF2_MANIFEST, "RTL8720C");

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("drops a failed download, so the next fetch downloads again", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce(uf2Response(new Uint8Array([1])));
    vi.stubGlobal("fetch", fetch);

    await expect(fetchPublishedUf2(UF2_MANIFEST, "LN882H")).rejects.toThrow(
      /esphome-web-ln882h\.uf2 failed \(404\)/
    );
    expect(await fetchPublishedUf2(UF2_MANIFEST, "LN882H")).toEqual(new Uint8Array([1]));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("fetchPublishedUf2, when the download stalls", () => {
  it("gives up at its deadline, so a later attempt downloads again", async () => {
    // The deadline, aborted here by hand rather than by the clock.
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal!.addEventListener("abort", () => reject(init.signal!.reason))
          )
      )
      .mockResolvedValueOnce(uf2Response(new Uint8Array([1])));
    vi.stubGlobal("fetch", fetch);

    const stalled = fetchPublishedUf2(UF2_MANIFEST, "LN882H");
    expect(timeout).toHaveBeenCalledWith(UF2_DOWNLOAD_TIMEOUT_MS);
    // Until the deadline, an attempt waits on the same download.
    expect(fetchPublishedUf2(UF2_MANIFEST, "LN882H")).toBe(stalled);
    deadline.abort(new DOMException("timed out", "TimeoutError"));

    await expect(stalled).rejects.toMatchObject({ name: "TimeoutError" });
    expect(await fetchPublishedUf2(UF2_MANIFEST, "LN882H")).toEqual(new Uint8Array([1]));
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("publishedKeys", () => {
  it("keeps the keys the manifest lists, in the order asked", () => {
    expect(publishedKeys(UF2_MANIFEST, ["RTL8710B", "RTL8720C"])).toEqual(["RTL8720C"]);
    expect(publishedKeys({ version: "1", builds: [] }, ["LN882H"])).toEqual([]);
  });
});

describe("publishedUf2Url", () => {
  it("builds the versioned UF2 url for the key", () => {
    expect(publishedUf2Url(UF2_MANIFEST, "RTL8720C")).toBe(
      "https://firmware.esphome.io/esphome-web/26.10.0/esphome-web-rtl8720c.uf2"
    );
  });
});
