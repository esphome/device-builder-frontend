import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestPicobootDevice: vi.fn(),
  loadPicoboot: vi.fn(),
}));
vi.mock("../../../src/platforms/rp2/web-usb.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestPicobootDevice: mocks.requestPicobootDevice,
  loadPicoboot: mocks.loadPicoboot,
}));

import {
  flashPico,
  PicoFlashError,
  picoFlashFailureCopy,
} from "../../../src/platforms/rp2/rp2-flash.js";
import { UF2_FAMILY_RP2040 } from "../../../src/util/uf2.js";

const image = { familyId: UF2_FAMILY_RP2040, ranges: [], totalBytes: 0 };
const bootsel = (productId = 0x0003) => ({ vendorId: 0x2e8a, productId }) as USBDevice;
const engine = (open: () => Promise<unknown>, flashUf2 = vi.fn(async () => {})) =>
  mocks.loadPicoboot.mockResolvedValue({ PicobootDevice: { open }, flashUf2 });
const localize = (key: string) => key;

afterEach(() => {
  vi.clearAllMocks();
});

describe("flashPico", () => {
  it("picks the bootloader, opens it, announces it and writes the image", async () => {
    const dev = { close: vi.fn() };
    const flashUf2 = vi.fn(async () => {});
    mocks.requestPicobootDevice.mockResolvedValue(bootsel());
    engine(async () => dev, flashUf2);
    const hooks = { onProgress: vi.fn(), onLog: vi.fn(), onDeviceOpened: vi.fn() };
    await expect(flashPico(image, hooks)).resolves.toBe(true);
    expect(hooks.onLog).toHaveBeenCalledWith("Claimed the RP2 Boot device (2e8a:0003)");
    expect(hooks.onDeviceOpened).toHaveBeenCalledOnce();
    expect(flashUf2).toHaveBeenCalledWith(dev, image, hooks);
    expect(dev.close).not.toHaveBeenCalled();
  });

  it("opens the chooser before the image has arrived, then writes it", async () => {
    let finish!: (uf2: typeof image) => void;
    const pending = new Promise<typeof image>((r) => (finish = r));
    const flashUf2 = vi.fn(async () => {});
    mocks.requestPicobootDevice.mockImplementation(async () => {
      finish(image);
      return bootsel();
    });
    engine(async () => ({}), flashUf2);
    await expect(flashPico(pending, { onProgress: () => {} })).resolves.toBe(true);
    expect(flashUf2).toHaveBeenCalledWith(expect.anything(), image, expect.anything());
  });

  it("reports a rejected image as its own kind, after the chooser", async () => {
    mocks.requestPicobootDevice.mockResolvedValue(bootsel());
    await expect(
      flashPico(Promise.reject(new Error("offline")), { onProgress: () => {} })
    ).rejects.toMatchObject({ kind: "image" });
    expect(mocks.requestPicobootDevice).toHaveBeenCalledOnce();
    expect(mocks.loadPicoboot).not.toHaveBeenCalled();
  });

  it("releases the claimed device when a hook throws before the write", async () => {
    const dev = { close: vi.fn(async () => {}) };
    const flashUf2 = vi.fn();
    mocks.requestPicobootDevice.mockResolvedValue(bootsel());
    engine(async () => dev, flashUf2);
    await expect(
      flashPico(image, {
        onProgress: () => {},
        onDeviceOpened: () => {
          throw new Error("hook");
        },
      })
    ).rejects.toMatchObject({ kind: "flash" });
    expect(dev.close).toHaveBeenCalledOnce();
    expect(flashUf2).not.toHaveBeenCalled();
  });

  it("is quiet when the chooser is dismissed", async () => {
    mocks.requestPicobootDevice.mockResolvedValue(null);
    await expect(flashPico(image, { onProgress: () => {} })).resolves.toBe(false);
    expect(mocks.loadPicoboot).not.toHaveBeenCalled();
  });

  it("closes a device opened after the caller moved on, unwritten", async () => {
    const dev = { close: vi.fn(async () => {}) };
    let current = true;
    mocks.requestPicobootDevice.mockResolvedValue(bootsel());
    const flashUf2 = vi.fn();
    engine(async () => {
      current = false;
      return dev;
    }, flashUf2);
    await expect(
      flashPico(image, { onProgress: () => {}, cancelled: () => !current })
    ).resolves.toBe(false);
    expect(dev.close).toHaveBeenCalledOnce();
    expect(flashUf2).not.toHaveBeenCalled();
  });

  it.each([
    { name: "an RP2350 bootloader", device: bootsel(0x000f), kind: "rp2350" },
    {
      name: "a device not in BOOTSEL",
      device: { vendorId: 1, productId: 1 },
      kind: "not-bootsel",
    },
  ])("refuses $name before opening it", async ({ device, kind }) => {
    mocks.requestPicobootDevice.mockResolvedValue(device);
    await expect(flashPico(image, { onProgress: () => {} })).rejects.toMatchObject({
      kind,
    });
    expect(mocks.loadPicoboot).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "a refused open",
      open: async () => {
        throw new DOMException("Access denied", "SecurityError");
      },
      write: async () => {},
      kind: "access-denied",
    },
    {
      name: "a device lost mid-write",
      open: async () => ({}),
      write: async () => {
        throw new DOMException("gone", "NetworkError");
      },
      kind: "device-lost",
    },
    {
      name: "a failed write",
      open: async () => ({}),
      write: async () => {
        throw new Error("bad write");
      },
      kind: "flash",
    },
  ])("names $name", async ({ open, write, kind }) => {
    mocks.requestPicobootDevice.mockResolvedValue(bootsel());
    engine(open, vi.fn(write));
    const err = await flashPico(image, { onProgress: () => {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PicoFlashError);
    expect((err as PicoFlashError).kind).toBe(kind);
  });
});

describe("picoFlashFailureCopy", () => {
  it("pairs each failure with the dashboard's title and detail", () => {
    const cause = new Error("why");
    expect(picoFlashFailureCopy(new PicoFlashError("rp2350"), localize)).toEqual({
      title: "firmware.rp2_rp2350_device",
      detail: "",
    });
    expect(
      picoFlashFailureCopy(new PicoFlashError("device-lost", cause), localize)
    ).toEqual({
      title: "firmware.rp2_flash_failed",
      detail: "firmware.rp2_device_lost",
    });
    expect(picoFlashFailureCopy(new PicoFlashError("flash", cause), localize)).toEqual({
      title: "firmware.rp2_flash_failed",
      detail: "why",
    });
    expect(
      picoFlashFailureCopy(new PicoFlashError("access-denied", cause), localize).title
    ).toBe("firmware.rp2_usb_access_denied");
  });
});
