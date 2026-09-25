import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestPicobootDevice: vi.fn(),
  loadPicoboot: vi.fn(),
  fetchEsphomeWebManifest: vi.fn(),
}));
vi.mock("../../src/util/web-usb.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestPicobootDevice: mocks.requestPicobootDevice,
  loadPicoboot: mocks.loadPicoboot,
}));
vi.mock("../../src/web/util/esphome-web-firmware.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  fetchEsphomeWebManifest: mocks.fetchEsphomeWebManifest,
}));

import { makeUf2Block } from "../_make-uf2-block.js";
import { UF2_FAMILY_RP2040, UF2_FAMILY_RP2350_ARM_S } from "../../src/util/uf2.js";
import {
  flashPico,
  loadPicoImage,
  PicoFlashError,
} from "../../src/web/install/pico-flash.js";

const image = { familyId: UF2_FAMILY_RP2040, ranges: [], totalBytes: 0 };
const bootsel = (productId = 0x0003) => ({ vendorId: 0x2e8a, productId }) as USBDevice;

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("loadPicoImage", () => {
  it("fetches the manifest's UF2 and parses it as an RP2040 image", async () => {
    mocks.fetchEsphomeWebManifest.mockResolvedValue({ version: "26.5.1", builds: [] });
    const fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => makeUf2Block({ addr: 0x10000000 }).buffer,
    }));
    vi.stubGlobal("fetch", fetch);
    const loaded = await loadPicoImage();
    expect(fetch).toHaveBeenCalledWith(
      "https://firmware.esphome.io/esphome-web/26.5.1/esphome-web-rp2040.uf2"
    );
    expect(loaded.familyId).toBe(UF2_FAMILY_RP2040);
    expect(loaded.totalBytes).toBe(256);
  });

  it("names a failed download and refuses another family", async () => {
    mocks.fetchEsphomeWebManifest.mockResolvedValue({ version: "26.5.1", builds: [] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404 }))
    );
    await expect(loadPicoImage()).rejects.toThrow(
      /esphome-web-rp2040\.uf2 failed \(404\)/
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () =>
          makeUf2Block({ addr: 0x10000000, family: UF2_FAMILY_RP2350_ARM_S }).buffer,
      }))
    );
    await expect(loadPicoImage()).rejects.toThrow(/family/);
  });
});

describe("flashPico", () => {
  it("picks the bootloader, opens it and writes the image", async () => {
    const dev = {};
    const open = vi.fn(async () => dev);
    const flashUf2 = vi.fn(async () => {});
    mocks.requestPicobootDevice.mockResolvedValue(bootsel());
    mocks.loadPicoboot.mockResolvedValue({ PicobootDevice: { open }, flashUf2 });
    const onProgress = vi.fn();
    await expect(flashPico(image, { onProgress })).resolves.toBe(true);
    expect(open).toHaveBeenCalledOnce();
    expect(flashUf2).toHaveBeenCalledWith(
      dev,
      image,
      expect.objectContaining({ onProgress })
    );
  });

  it("is quiet when the chooser is dismissed", async () => {
    mocks.requestPicobootDevice.mockResolvedValue(null);
    await expect(flashPico(image, { onProgress: () => {} })).resolves.toBe(false);
    expect(mocks.loadPicoboot).not.toHaveBeenCalled();
  });

  it.each([
    { name: "an RP2350 bootloader", device: bootsel(0x000f), kind: "rp2350" },
    {
      name: "a device that is not in BOOTSEL",
      device: { vendorId: 1, productId: 1 },
      kind: "not-bootsel",
    },
  ])("refuses $name", async ({ device, kind }) => {
    mocks.requestPicobootDevice.mockResolvedValue(device);
    await expect(flashPico(image, { onProgress: () => {} })).rejects.toMatchObject({
      kind,
    });
  });

  it("tells a refused open, a lost device and a failed write apart", async () => {
    mocks.requestPicobootDevice.mockResolvedValue(bootsel());
    const denied = new DOMException("Access denied", "SecurityError");
    mocks.loadPicoboot.mockResolvedValue({
      PicobootDevice: {
        open: vi.fn(async () => {
          throw denied;
        }),
      },
      flashUf2: vi.fn(),
    });
    await expect(flashPico(image, { onProgress: () => {} })).rejects.toMatchObject({
      kind: "access-denied",
      cause: denied,
    });
    const flashUf2 = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("gone", "NetworkError"))
      .mockRejectedValueOnce(new Error("bad write"));
    mocks.loadPicoboot.mockResolvedValue({
      PicobootDevice: { open: vi.fn(async () => ({})) },
      flashUf2,
    });
    await expect(flashPico(image, { onProgress: () => {} })).rejects.toMatchObject({
      kind: "device-lost",
    });
    const err = await flashPico(image, { onProgress: () => {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PicoFlashError);
    expect((err as PicoFlashError).kind).toBe("flash");
  });
});
