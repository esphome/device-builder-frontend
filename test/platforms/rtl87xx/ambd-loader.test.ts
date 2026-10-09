import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AMBD_LOADER_SHA256,
  AMBD_LOADER_URL,
  loadAmbdLoader,
  resetAmbdLoaderForTests,
} from "../../../src/platforms/rtl87xx/ambd-loader.js";

const LOADER = Uint8Array.from({ length: 4688 }, (_, i) => (i * 3 + 1) % 255);
const expectedDigest = Uint8Array.from(
  AMBD_LOADER_SHA256.match(/../g)!.map((h) => parseInt(h, 16))
);
const fetchMock = vi.fn<typeof fetch>();
const realFetch = globalThis.fetch;

beforeEach(() => {
  resetAmbdLoaderForTests();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(LOADER.slice()));
  globalThis.fetch = fetchMock;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

/** The stand-in blob hashes to the pinned value. */
const asExpectedFile = () =>
  vi.spyOn(crypto.subtle, "digest").mockResolvedValue(expectedDigest.buffer.slice(0));

describe("loadAmbdLoader", () => {
  it("fetches Realtek's pinned copy once and keeps it", async () => {
    asExpectedFile();
    expect(await loadAmbdLoader()).toEqual(LOADER);
    expect(await loadAmbdLoader()).toEqual(LOADER);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(AMBD_LOADER_URL);
    expect(AMBD_LOADER_URL).toMatch(
      /^https:\/\/cdn\.jsdelivr\.net\/gh\/Ameba-AIoT\/ameba-arduino-d@[0-9a-f]{40}\//
    );
  });

  it("refuses a file that is not the one the hash names", async () => {
    await expect(loadAmbdLoader()).rejects.toMatchObject({
      name: "AmbdLoaderError",
      key: "firmware.rtl_ambd_loader_mismatch",
    });
  });

  it("names a download that failed, and fetches again next time", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await expect(loadAmbdLoader()).rejects.toMatchObject({
      name: "AmbdLoaderError",
      key: "firmware.rtl_ambd_loader_unavailable",
      message: expect.stringContaining("HTTP 404"),
    });
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(loadAmbdLoader()).rejects.toMatchObject({
      key: "firmware.rtl_ambd_loader_unavailable",
      message: expect.stringContaining("Failed to fetch"),
    });
    asExpectedFile();
    expect(await loadAmbdLoader()).toEqual(LOADER);
  });
});
