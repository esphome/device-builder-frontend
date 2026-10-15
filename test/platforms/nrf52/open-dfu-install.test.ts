// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { flashSecureDfuPackage as FlashSecure } from "../../../src/platforms/nrf52/nrf-secure-dfu.js";
import type { resetToBootloader as ResetToBootloader } from "../../../src/util/serial-bootloader-touch.js";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  resetToBootloader: vi.fn<typeof ResetToBootloader>(async () => {}),
  flashSecureDfuPackage: vi.fn<typeof FlashSecure>(),
  notifyError: vi.fn(),
}));
vi.mock("../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../src/util/serial-bootloader-touch.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resetToBootloader: mocks.resetToBootloader,
}));
vi.mock("../../../src/platforms/nrf52/nrf-secure-dfu.js", () => ({
  flashSecureDfuPackage: mocks.flashSecureDfuPackage,
}));
vi.mock("../../../src/util/notify.js", () => ({ notifyError: mocks.notifyError }));

import { argsLocalize } from "../../_dom.js";
import { withWebSerial } from "../../_web-serial.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { DfuResponseError } from "../../../src/platforms/nrf52/dfu-response-error.js";
import type { DfuPackage } from "../../../src/platforms/nrf52/nrf-dfu.js";
import {
  nrfOpenDfuInstall,
  nrfOpenDoFlash,
  nrfOpenDoReset,
  nrfOpenPackage,
} from "../../../src/platforms/nrf52/open-dfu-install.js";
import { PortNotAcceptedError } from "../../../src/util/web-serial.js";
import {
  asHost,
  bin,
  makeFlashHost,
} from "../../components/firmware-install-dialog/_flash-host.js";
import { makeUsbPort } from "../../web/_make-web-serial-port.js";

const device = {
  configuration: "dongle.yaml",
  name: "dongle",
  target_platform: "nrf52",
  bootloader: "nrf",
} as ConfiguredDevice;
const pkg: DfuPackage = {
  parts: [
    { type: "application", mode: 4, bin: new Uint8Array(4), dat: new Uint8Array(2) },
  ],
};
const APP_FILTER = { usbVendorId: 0x2fe3, usbProductId: 0x0100 };
const BOOTLOADER_FILTER = { usbVendorId: 0x1915, usbProductId: 0x521f };

function readyHost() {
  const host = makeFlashHost(device, {
    binaries: [bin("firmware.zip")],
    downloadBytes: new ArrayBuffer(0),
  });
  host._localize = argsLocalize;
  nrfOpenPackage.set(asHost(host), pkg);
  // As the reset step leaves it.
  host._step = "nrf-open-reset";
  host._statusMessage = "firmware.nrf_step1_title";
  return host;
}

let restoreSerial = () => {};
beforeEach(() => {
  vi.clearAllMocks();
  restoreSerial = withWebSerial(true, { getPorts: vi.fn(async () => []) });
  mocks.requestSerialPort.mockImplementation(
    async (_options?: SerialPortRequestOptions, accept?: (p: SerialPort) => boolean) => {
      const port = makeUsbPort(0x2fe3, 0x0100);
      if (accept && !accept(port)) throw new PortNotAcceptedError(port);
      return port;
    }
  );
});
afterEach(() => restoreSerial());

describe("nrfOpenDoReset", () => {
  it("touches the application's own port, narrowed to its USB ids", async () => {
    const host = readyHost();
    mocks.resetToBootloader.mockImplementation(async (_port, onLog) => {
      onLog?.("Touching the port at 1200 baud");
    });
    await nrfOpenDoReset(asHost(host));
    expect(mocks.requestSerialPort).toHaveBeenCalledWith(
      { filters: [APP_FILTER] },
      expect.any(Function)
    );
    expect(mocks.resetToBootloader).toHaveBeenCalledOnce();
    expect(host._log.lines).toEqual(["Touching the port at 1200 baud"]);
    expect(host._step).toBe("nrf-open-wait");
    expect(host._statusMessage).toBe("firmware.nrf_open_step2_title");
  });

  it("turns a port that is not ESPHome's away untouched", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockImplementation(async (_o, accept) => {
      const probe = makeUsbPort(0x1915, 0x521f);
      if (accept && !accept(probe)) throw new PortNotAcceptedError(probe);
      return probe;
    });
    await nrfOpenDoReset(asHost(host));
    expect(mocks.resetToBootloader).not.toHaveBeenCalled();
    expect(mocks.notifyError).toHaveBeenCalledWith("firmware.nrf_open_port_refused");
    expect(host._step).toBe("nrf-open-reset");
  });

  it("says to press RESET when the touch fails", async () => {
    const host = readyHost();
    const { BootloaderTouchError } =
      await import("../../../src/util/serial-bootloader-touch.js");
    mocks.resetToBootloader.mockRejectedValueOnce(
      new BootloaderTouchError(new Error("Failed to open serial port."))
    );
    await nrfOpenDoReset(asHost(host));
    expect(host._step).toBe("error");
    expect(host._errorMessage).toBe(
      "firmware.nrf_open_manual_bootloader_hint | Failed to open serial port"
    );
  });
});

describe("nrfOpenDoFlash", () => {
  it("picks the bootloader's own port and streams the engine's lines", async () => {
    const host = readyHost();
    mocks.flashSecureDfuPackage.mockImplementation(async (_p, _pkg, hooks) => {
      hooks.onLog?.("Pinging the bootloader");
      hooks.onProgress(50);
      hooks.onLog?.("Transfer complete; the bootloader starts the firmware");
    });
    await nrfOpenDoFlash(asHost(host));
    expect(mocks.requestSerialPort).toHaveBeenCalledWith({
      filters: [BOOTLOADER_FILTER],
    });
    expect(mocks.flashSecureDfuPackage).toHaveBeenCalledWith(
      expect.anything(),
      pkg,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(host._log.lines).toEqual([
      "Pinging the bootloader",
      "Transfer complete; the bootloader starts the firmware",
    ]);
    expect(host._flashPercent).toBe(50);
    expect(host._step).toBe("done");
  });

  it("drops a late line once the dialog moved on", async () => {
    const host = readyHost();
    mocks.flashSecureDfuPackage.mockImplementation(async (_p, _pkg, hooks) => {
      host._device = { ...device, name: "other" } as ConfiguredDevice;
      hooks.onLog?.("Transfer complete");
    });
    await nrfOpenDoFlash(asHost(host));
    expect(host._log.lines).toEqual([]);
  });

  it.each([
    [
      "a bootloader that never answered, with the RESET hint",
      new Error("No answer from the bootloader in 1000 ms"),
      "firmware.nrf_open_manual_bootloader_hint | No answer from the bootloader in 1000 ms",
    ],
    [
      "a bootloader that refused the update, bare",
      new DfuResponseError("Execute object", "the bootloader refused it: no downgrade"),
      "Execute object: the bootloader refused it: no downgrade",
    ],
  ])("names a flash that failed on %s", async (_name, err, detail) => {
    const host = readyHost();
    mocks.flashSecureDfuPackage.mockRejectedValueOnce(err);
    await nrfOpenDoFlash(asHost(host));
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.nrf_flash_failed");
    expect(host._errorMessage).toBe(detail);
  });
});

describe("showFirstStep", () => {
  it("skips the touch when the bootloader's port is granted and plugged in", async () => {
    const host = readyHost();
    const granted = Object.assign(makeUsbPort(0x1915, 0x521f), { connected: true });
    restoreSerial();
    restoreSerial = withWebSerial(true, { getPorts: vi.fn(async () => [granted]) });
    nrfOpenDfuInstall.showFirstStep(asHost(host));
    expect(host._step).toBe("nrf-open-reset");
    await vi.waitFor(() => expect(host._step).toBe("nrf-open-wait"));
    expect(host._statusMessage).toBe("firmware.nrf_open_step2_title");
  });

  it.each([
    [
      "an unplugged grant",
      Object.assign(makeUsbPort(0x1915, 0x521f), { connected: false }),
    ],
    [
      "the application's port",
      Object.assign(makeUsbPort(0x2fe3, 0x0100), { connected: true }),
    ],
  ])("stays on the reset step with %s", async (_name, port) => {
    const host = readyHost();
    restoreSerial();
    restoreSerial = withWebSerial(true, { getPorts: vi.fn(async () => [port]) });
    nrfOpenDfuInstall.showFirstStep(asHost(host));
    await new Promise((r) => setTimeout(r, 5));
    expect(host._step).toBe("nrf-open-reset");
  });
});

describe("nrfOpenDfuInstall", () => {
  it("picks one of the application's ports for the logs afterwards", async () => {
    const port = makeUsbPort(0x2fe3, 0x0100);
    mocks.requestSerialPort.mockResolvedValue(port);
    expect(await nrfOpenDfuInstall.pickLogsPort!(argsLocalize)).toBe(port);
    expect(mocks.requestSerialPort).toHaveBeenCalledWith({ filters: [APP_FILTER] });
  });

  it("is for the nRF5 SDK bootloader, handed off as Secure DFU", () => {
    expect(nrfOpenDfuInstall.bootloaders).toEqual(["nrf"]);
    expect(nrfOpenDfuInstall.handoff?.flasher).toBe("nrf-secure-dfu");
    expect(nrfOpenDfuInstall.handoff?.erase).toBe(false);
  });

  // Every nRF52 running ESPHome carries the same USB ids, so a touch on
  // another board's port "succeeds": the wait step keeps Reset to try again.
  it("offers Reset beside Flash on both steps", () => {
    for (const step of ["nrf-open-reset", "nrf-open-wait"] as const) {
      const footer = nrfOpenDfuInstall.steps[step].footer!();
      expect(footer.primary.run).toBe(nrfOpenDoFlash);
      expect(footer.secondary?.run).toBe(nrfOpenDoReset);
    }
  });
});
