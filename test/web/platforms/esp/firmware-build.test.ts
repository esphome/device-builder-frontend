import { afterEach, describe, expect, it, vi } from "vitest";

import { downloadBuildParts } from "../../../../src/web/platforms/esp/firmware-build.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
