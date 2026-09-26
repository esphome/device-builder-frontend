// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { flashUf2 as FlashUf2 } from "../../../src/platforms/rp2/rp2-picoboot.js";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  resetToBootloader: vi.fn(),
  requestPicobootDevice: vi.fn(),
  picobootOpen: vi.fn(),
  flashUf2: vi.fn<typeof FlashUf2>(),
  downloadSelectedBinary: vi.fn(),
  finishWithLogsPort: vi.fn(),
  notifyError: vi.fn(),
}));
vi.mock("../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../src/util/notify.js", () => ({ notifyError: mocks.notifyError }));
vi.mock("../../../src/util/serial-bootloader-touch.js", () => ({
  resetToBootloader: mocks.resetToBootloader,
}));
vi.mock("../../../src/platforms/rp2/web-usb.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestPicobootDevice: mocks.requestPicobootDevice,
}));
vi.mock("../../../src/platforms/rp2/rp2-picoboot.js", () => ({
  PicobootDevice: { open: mocks.picobootOpen },
  flashUf2: mocks.flashUf2,
}));
vi.mock(
  "../../../src/components/firmware-install-dialog/install-flow.js",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    downloadSelectedBinary: mocks.downloadSelectedBinary,
    finishWithLogsPort: mocks.finishWithLogsPort,
  })
);

import { makeUf2Block } from "../../_make-uf2-block.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import type { FirmwareBinary } from "../../../src/api/types/firmware-jobs.js";
import {
  rp2DoDownload,
  rp2DoFlash,
  rp2DoReset,
  rp2Image,
  rp2Uf2Install,
  startRp2Uf2Install,
} from "../../../src/platforms/rp2/uf2-install.js";
import { RP2_SERIAL_PICK } from "../../../src/platforms/rp2/web-usb.js";
import {
  UF2_FAMILY_RP2040,
  UF2_FAMILY_RP2350_ARM_S,
  type Uf2Image,
} from "../../../src/util/uf2.js";
import { PortNotAcceptedError } from "../../../src/util/web-serial.js";
import {
  asHost,
  bin,
  makeFlashHost,
} from "../../components/firmware-install-dialog/_flash-host.js";

const uf2 = (family: number): ArrayBuffer =>
  makeUf2Block({ addr: 0x10000000, family }).buffer;

const device = {
  configuration: "pico.yaml",
  name: "pico",
  target_platform: "rp2",
} as ConfiguredDevice;
const image: Uf2Image = {
  familyId: UF2_FAMILY_RP2040,
  ranges: [{ address: 0x10000000, data: new Uint8Array(256) }],
  totalBytes: 256,
};

function makeHost(opts: { binaries?: FirmwareBinary[]; uf2Family?: number } = {}) {
  return makeFlashHost(device, {
    binaries: opts.binaries ?? [
      bin("firmware.uf2", "uf2"),
      bin("firmware.ota.bin", "ota"),
    ],
    downloadBytes: uf2(opts.uf2Family ?? UF2_FAMILY_RP2040),
  });
}
type Host = ReturnType<typeof makeHost>;

function readyHost(): Host {
  const host = makeHost();
  // A fresh image per install, as a real parse gives: the touched port is
  // recorded against it.
  rp2Image.set(asHost(host), { ...image });
  host._binaries = [bin("firmware.uf2", "uf2")];
  // As showBootselStep leaves it.
  host._step = "rp2-bootsel";
  host._statusMessage = "firmware.rp2_bootsel_title";
  return host;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startRp2Uf2Install", () => {
  it("compiles, picks the UF2 by type, parses it and lands on the BOOTSEL step", async () => {
    const host = makeHost();
    await startRp2Uf2Install(asHost(host));
    expect(host._api.firmwareDownloadBytes).toHaveBeenCalledWith(
      "pico.yaml",
      "firmware.uf2"
    );
    expect(rp2Image.get(asHost(host))?.totalBytes).toBe(256);
    expect(host._binaries.map((b) => b.file)).toEqual(["firmware.uf2"]);
    expect(host._step).toBe("rp2-bootsel");
    expect(host._statusMessage).toBe("firmware.rp2_bootsel_title");
  });

  it("fails when the build produced no UF2", async () => {
    const host = makeHost({ binaries: [bin("firmware.ota.bin", "ota")] });
    await startRp2Uf2Install(asHost(host));
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.no_uf2");
    expect(host._api.firmwareDownloadBytes).not.toHaveBeenCalled();
  });

  it("refuses an RP2350 image with the family in the detail", async () => {
    const host = makeHost({ uf2Family: UF2_FAMILY_RP2350_ARM_S });
    await startRp2Uf2Install(asHost(host));
    expect(host._statusMessage).toBe("firmware.rp2_rp2350_unsupported");
    expect(host._errorMessage).toContain("0xe48bff59");
    expect(rp2Image.get(asHost(host))).toBeNull();
  });

  it("treats a UF2 without a family id as a bad file, not an RP2350 image", async () => {
    const host = makeHost();
    vi.mocked(host._api.firmwareDownloadBytes).mockResolvedValue(
      makeUf2Block({ addr: 0x10000000, family: null }).buffer
    );
    await startRp2Uf2Install(asHost(host));
    expect(host._statusMessage).toBe("firmware.rp2_bad_uf2");
    expect(host._errorMessage).toContain("family none");
  });

  it("leaves a dialog that moved to another device untouched", async () => {
    const host = makeHost();
    vi.mocked(host._api.firmwareDownloadBytes).mockImplementation(async () => {
      host._device = { ...device, configuration: "other.yaml" } as ConfiguredDevice;
      return uf2(UF2_FAMILY_RP2040);
    });
    await startRp2Uf2Install(asHost(host));
    expect(rp2Image.get(asHost(host))).toBeNull();
    expect(host._step).not.toBe("rp2-bootsel");
  });
});

describe("rp2DoReset", () => {
  it("restores the step title when the port picker is dismissed", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue(null);
    await rp2DoReset(asHost(host));
    expect(host._step).toBe("rp2-bootsel");
    expect(host._statusMessage).toBe("firmware.rp2_bootsel_title");
    expect(host._flashBusy).toBe(false);
    expect(mocks.resetToBootloader).not.toHaveBeenCalled();
  });

  it("touches the port at 1200 baud and moves to the wait step", async () => {
    const host = readyHost();
    const port = {};
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.resetToBootloader.mockResolvedValue(undefined);
    await rp2DoReset(asHost(host));
    expect(mocks.resetToBootloader).toHaveBeenCalledWith(port, expect.any(Function));
    expect(host._step).toBe("rp2-wait");
    expect(host._statusMessage).toBe("firmware.rp2_wait_title");
  });

  it("reports a failed touch", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.resetToBootloader.mockRejectedValue(new Error("open failed"));
    await rp2DoReset(asHost(host));
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.browser_flash_connect_failed");
    expect(host._errorMessage).toBe("open failed");
  });

  it("does not touch a port picked after the dialog was dismissed", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockImplementation(async () => {
      host._device = null;
      return {};
    });
    await rp2DoReset(asHost(host));
    expect(mocks.resetToBootloader).not.toHaveBeenCalled();
    expect(host._step).toBe("rp2-bootsel");
  });

  it("ignores a click while a step is already pending", async () => {
    const host = readyHost();
    host._flashBusy = true;
    await rp2DoReset(asHost(host));
    expect(mocks.requestSerialPort).not.toHaveBeenCalled();
  });
});

describe("rp2DoFlash", () => {
  const bootsel = { vendorId: 0x2e8a, productId: 0x0003 };

  it("does nothing when the chooser is dismissed", async () => {
    const host = readyHost();
    mocks.requestPicobootDevice.mockResolvedValue(null);
    await rp2DoFlash(asHost(host));
    expect(host._step).toBe("rp2-bootsel");
    expect(host._flashBusy).toBe(false);
    expect(mocks.picobootOpen).not.toHaveBeenCalled();
  });

  it("refuses an RP2350 board for an RP2040 build", async () => {
    const host = readyHost();
    mocks.requestPicobootDevice.mockResolvedValue({
      vendorId: 0x2e8a,
      productId: 0x000f,
    });
    await rp2DoFlash(asHost(host));
    expect(host._statusMessage).toBe("firmware.rp2_rp2350_device");
    expect(mocks.picobootOpen).not.toHaveBeenCalled();
  });

  it("releases a device opened after the dialog moved on", async () => {
    const host = readyHost();
    const dev = { close: vi.fn(async () => {}) };
    mocks.requestPicobootDevice.mockResolvedValue(bootsel);
    mocks.picobootOpen.mockImplementation(async () => {
      host._device = null;
      return dev;
    });
    await rp2DoFlash(asHost(host));
    expect(dev.close).toHaveBeenCalled();
    expect(mocks.flashUf2).not.toHaveBeenCalled();
    expect(host._step).toBe("rp2-bootsel");
  });

  it("names a refused open (udev) distinctly", async () => {
    const host = readyHost();
    mocks.requestPicobootDevice.mockResolvedValue(bootsel);
    mocks.picobootOpen.mockRejectedValue(
      new DOMException("Access denied.", "SecurityError")
    );
    await rp2DoFlash(asHost(host));
    expect(host._statusMessage).toBe("firmware.rp2_usb_access_denied");
    expect(host._flashBusy).toBe(false);
  });

  it("flashes with progress and lands on done", async () => {
    const host = readyHost();
    const dev = { device: bootsel, close: vi.fn() };
    mocks.requestPicobootDevice.mockResolvedValue(bootsel);
    mocks.picobootOpen.mockResolvedValue(dev);
    mocks.flashUf2.mockImplementation(async (_d, _i, hooks) => {
      hooks.onProgress(50);
      hooks.onLog?.("Rebooting into the firmware");
      hooks.onProgress(100);
    });
    await rp2DoFlash(asHost(host));
    expect(mocks.flashUf2).toHaveBeenCalledWith(
      dev,
      image,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onLog: expect.any(Function),
      })
    );
    expect(host._flashPercent).toBe(100);
    expect(host._step).toBe("done");
    expect(host._flashAbort).toBeNull();
    // The claimed device and the engine's lines land in the details log.
    expect(host._log.lines[0]).toBe("Claimed the RP2 Boot device (2e8a:0003)");
    expect(host._log.lines).toContain("Rebooting into the firmware");
  });

  it("drops a late line once the dialog moved on", async () => {
    const host = readyHost();
    mocks.requestPicobootDevice.mockResolvedValue(bootsel);
    mocks.picobootOpen.mockResolvedValue({ device: bootsel });
    mocks.flashUf2.mockImplementation(async (_d, _i, hooks) => {
      host._device = null;
      hooks.onLog?.("Rebooting into the firmware");
    });
    await rp2DoFlash(asHost(host));
    expect(host._log.lines).not.toContain("Rebooting into the firmware");
  });

  it("reports an unexpected error from the write instead of dropping it", async () => {
    const host = readyHost();
    mocks.requestPicobootDevice.mockResolvedValue(bootsel);
    mocks.picobootOpen.mockResolvedValue({ device: bootsel });
    mocks.flashUf2.mockRejectedValue(new Error("odd"));
    await rp2DoFlash(asHost(host));
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.rp2_flash_failed");
    expect(host._errorMessage).toBe("odd");
  });

  it("reports a device lost mid-flash with the BOOTSEL hint", async () => {
    const host = readyHost();
    mocks.requestPicobootDevice.mockResolvedValue(bootsel);
    mocks.picobootOpen.mockResolvedValue({ device: bootsel });
    mocks.flashUf2.mockRejectedValue(new DOMException("gone", "NetworkError"));
    await rp2DoFlash(asHost(host));
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.rp2_flash_failed");
    expect(host._errorMessage).toBe("firmware.rp2_device_lost");
  });

  it("stays silent when the dialog was torn down during the flash", async () => {
    const host = readyHost();
    mocks.requestPicobootDevice.mockResolvedValue(bootsel);
    mocks.picobootOpen.mockResolvedValue({ device: bootsel });
    mocks.flashUf2.mockImplementation(async () => {
      host._device = null;
      host._flashAbort?.abort();
      throw new DOMException("aborted", "AbortError");
    });
    await rp2DoFlash(asHost(host));
    expect(host._step).toBe("flashing");
    expect(host._errorMessage).toBe("");
  });
});

describe("retry and download", () => {
  it("goes back to the BOOTSEL step as the Retry target", () => {
    const host = readyHost();
    host._step = "error";
    rp2Uf2Install.showFirstStep(asHost(host));
    expect(host._step).toBe("rp2-bootsel");
    expect(host._statusMessage).toBe("firmware.rp2_bootsel_title");
  });

  it("downloads the held UF2 through the shared binary download", () => {
    const host = readyHost();
    rp2DoDownload(asHost(host));
    expect(mocks.downloadSelectedBinary).toHaveBeenCalledWith(host, "firmware.uf2");
  });
});

describe("logs after a Pico install", () => {
  const bootsel = { vendorId: 0x2e8a, productId: 0x0003 };
  const flashOk = () => {
    mocks.requestPicobootDevice.mockResolvedValue(bootsel);
    mocks.picobootOpen.mockResolvedValue({ device: bootsel, close: vi.fn() });
    mocks.flashUf2.mockResolvedValue(undefined);
  };

  it("hands the port the BOOTSEL touch went through to the logs", async () => {
    const host = readyHost();
    const cdc = {} as SerialPort;
    mocks.requestSerialPort.mockResolvedValue(cdc);
    mocks.resetToBootloader.mockResolvedValue(undefined);
    await rp2DoReset(asHost(host));
    flashOk();
    await rp2DoFlash(asHost(host));
    expect(mocks.finishWithLogsPort).toHaveBeenCalledWith(host, cdc);
  });

  it("ends on done without a port when nothing was touched (BOOTSEL by hand)", async () => {
    const host = readyHost();
    flashOk();
    await rp2DoFlash(asHost(host));
    expect(host._step).toBe("done");
    expect(mocks.finishWithLogsPort).not.toHaveBeenCalled();
  });

  it("holds a port only where the WebUSB write runs", () => {
    const had = "usb" in navigator;
    Object.defineProperty(navigator, "usb", { configurable: true, value: {} });
    expect(rp2Uf2Install.holdsPort).toBe(true);
    Reflect.deleteProperty(navigator, "usb");
    expect(rp2Uf2Install.holdsPort).toBe(false);
    if (had) Object.defineProperty(navigator, "usb", { configurable: true, value: {} });
  });

  describe("pickLogsPort", () => {
    const localize = (key: string) => key;

    it("picks the Pico's own port through the shared Pico pick", async () => {
      const cdc = {} as SerialPort;
      mocks.requestSerialPort.mockResolvedValue(cdc);
      expect(await rp2Uf2Install.pickLogsPort!(localize)).toBe(cdc);
      expect(mocks.requestSerialPort).toHaveBeenCalledWith(
        { filters: RP2_SERIAL_PICK.filters },
        RP2_SERIAL_PICK.accept
      );
    });

    it("turns a debug probe away with a toast", async () => {
      mocks.requestSerialPort.mockRejectedValue(
        new PortNotAcceptedError({} as SerialPort)
      );
      expect(await rp2Uf2Install.pickLogsPort!(localize)).toBeNull();
      expect(mocks.notifyError).toHaveBeenCalledWith("firmware.rp2_not_a_pico");
    });

    it("stays quiet when the picker is dismissed", async () => {
      mocks.requestSerialPort.mockResolvedValue(null);
      expect(await rp2Uf2Install.pickLogsPort!(localize)).toBeNull();
      expect(mocks.notifyError).not.toHaveBeenCalled();
    });
  });
});
