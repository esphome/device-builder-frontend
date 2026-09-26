// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { flashDfuPackageWithReconnect as FlashWithReconnect } from "../../../src/platforms/nrf52/nrf-dfu.js";
import type { resetToBootloader as ResetToBootloader } from "../../../src/util/serial-bootloader-touch.js";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  resetToBootloader: vi.fn<typeof ResetToBootloader>(async () => {}),
  flashDfuPackageWithReconnect: vi.fn<typeof FlashWithReconnect>(),
}));
vi.mock("../../../src/util/web-serial.js", () => ({
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../src/util/serial-bootloader-touch.js", () => ({
  resetToBootloader: mocks.resetToBootloader,
}));
vi.mock("../../../src/platforms/nrf52/nrf-dfu.js", () => ({
  flashDfuPackageWithReconnect: mocks.flashDfuPackageWithReconnect,
}));

import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import {
  nrfDoFlash,
  nrfDoReset,
  nrfPackage,
} from "../../../src/platforms/nrf52/dfu-install.js";
import type { DfuPackage } from "../../../src/platforms/nrf52/nrf-dfu.js";
import {
  asHost,
  bin,
  makeFlashHost,
} from "../../components/firmware-install-dialog/_flash-host.js";

const device = {
  configuration: "itsy.yaml",
  name: "itsy",
  target_platform: "nrf52",
} as ConfiguredDevice;
const pkg: DfuPackage = {
  parts: [
    { type: "application", mode: 4, bin: new Uint8Array(4), dat: new Uint8Array(2) },
  ],
};

function readyHost() {
  const host = makeFlashHost(
    device,
    { binaries: [bin("firmware.zip")], downloadBytes: new ArrayBuffer(0) },
    {}
  );
  nrfPackage.set(asHost(host), pkg);
  // As the reset step leaves it.
  host._step = "nrf-reset";
  host._statusMessage = "firmware.nrf_step1_title";
  return host;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestSerialPort.mockResolvedValue({});
});

describe("nrfDoReset", () => {
  it("hands the touch a logger into the details log", async () => {
    const host = readyHost();
    const port = {};
    mocks.requestSerialPort.mockResolvedValue(port);
    mocks.resetToBootloader.mockImplementation(async (_port, onLog) => {
      onLog?.("Touching the port at 1200 baud");
    });
    await nrfDoReset(asHost(host));
    expect(mocks.resetToBootloader).toHaveBeenCalledWith(port, expect.any(Function));
    expect(host._log.lines).toEqual(["Touching the port at 1200 baud"]);
    expect(host._step).toBe("nrf-wait");
  });
});

describe("nrfDoFlash", () => {
  it("streams the engine's step lines into the details log", async () => {
    const host = readyHost();
    mocks.flashDfuPackageWithReconnect.mockImplementation(async (_p, _pkg, hooks) => {
      hooks.onLog?.("Opening the DFU port at 115200 baud");
      hooks.onProgress(50);
      hooks.onLog?.("Sending the stop packet");
    });
    await nrfDoFlash(asHost(host));
    expect(host._log.lines).toEqual([
      "Opening the DFU port at 115200 baud",
      "Sending the stop packet",
    ]);
    expect(host._flashPercent).toBe(50);
    expect(host._step).toBe("done");
  });

  it("drops a late line once the dialog moved on", async () => {
    const host = readyHost();
    mocks.flashDfuPackageWithReconnect.mockImplementation(async (_p, _pkg, hooks) => {
      host._device = { ...device, name: "other" } as ConfiguredDevice;
      hooks.onLog?.("Sending the stop packet");
    });
    await nrfDoFlash(asHost(host));
    expect(host._log.lines).toEqual([]);
  });
});
