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

import { lapsedPick } from "../../_web-serial.js";
import {
  flashPico,
  PicoFlashError,
  picoFlashFailureCopy,
  PicoWrongBoardError,
} from "../../../src/platforms/rp2/rp2-flash.js";
import { UF2_FAMILY_RP2040, UF2_FAMILY_RP2350_ARM_S } from "../../../src/util/uf2.js";

const image = { familyId: UF2_FAMILY_RP2040, ranges: [], totalBytes: 0 };
const image2350 = { familyId: UF2_FAMILY_RP2350_ARM_S, ranges: [], totalBytes: 0 };
const RP2350_PID = 0x000f;
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

  it("refuses a device not in BOOTSEL before opening it", async () => {
    mocks.requestPicobootDevice.mockResolvedValue({ vendorId: 1, productId: 1 });
    await expect(flashPico(image, { onProgress: () => {} })).rejects.toMatchObject({
      kind: "not-bootsel",
    });
    expect(mocks.loadPicoboot).not.toHaveBeenCalled();
  });

  it("writes an RP2350 image to an RP2350", async () => {
    const dev = { close: vi.fn(async () => {}) };
    const flashUf2 = vi.fn(async () => {});
    mocks.requestPicobootDevice.mockResolvedValue(bootsel(RP2350_PID));
    engine(async () => dev, flashUf2);
    await expect(flashPico(image2350, { onProgress: () => {} })).resolves.toBe(true);
    expect(flashUf2).toHaveBeenCalledWith(dev, image2350, expect.anything());
  });

  it.each([
    {
      name: "an RP2040 image on an RP2350",
      uf2: image,
      pid: RP2350_PID,
      board: "rp2350",
      chip: "rp2040",
    },
    {
      name: "an RP2350 image on an RP2040",
      uf2: image2350,
      pid: 0x0003,
      board: "rp2040",
      chip: "rp2350",
    },
  ])("refuses $name before opening it", async ({ uf2, pid, board, chip }) => {
    mocks.requestPicobootDevice.mockResolvedValue(bootsel(pid));
    await expect(flashPico(uf2, { onProgress: () => {} })).rejects.toMatchObject({
      kind: "wrong-board",
      board,
      image: chip,
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
    const named = vi.fn((key: string) => key);
    expect(
      picoFlashFailureCopy(new PicoWrongBoardError("rp2350", "rp2040"), named)
    ).toEqual({ title: "firmware.rp2_wrong_board", detail: "" });
    expect(named).toHaveBeenCalledWith("firmware.rp2_wrong_board", {
      board: "RP2350",
      image: "RP2040",
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

  it("says to click again for a chooser refused after the click ran out", () => {
    const refused = lapsedPick();
    expect(
      picoFlashFailureCopy(new PicoFlashError("connect", refused), localize)
    ).toEqual({
      title: "firmware.browser_flash_connect_failed",
      detail: "serial.picker_needs_click",
    });
  });
});
