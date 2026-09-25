// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  resetToBootloader: vi.fn(async () => {}),
  flashDfuPackageWithReconnect:
    vi.fn<
      (
        p: unknown,
        pkg: unknown,
        onProgress: (p: number) => void,
        o: FlashOptions
      ) => Promise<void>
    >(),
}));
type FlashOptions = {
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  onReconnecting?: () => void;
};
vi.mock("../../../src/util/web-serial.js", () => ({
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../src/util/serial-bootloader-touch.js", () => ({
  resetToBootloader: mocks.resetToBootloader,
}));
vi.mock("../../../src/util/nrf-dfu.js", () => ({
  flashDfuPackageWithReconnect: mocks.flashDfuPackageWithReconnect,
}));

import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import {
  nrfDoFlash,
  nrfDoReset,
} from "../../../src/components/firmware-install-dialog/nrf-dfu-install.js";
import type { DfuPackage } from "../../../src/util/nrf-dfu.js";
import { asHost, bin, makeFlashHost } from "./_flash-host.js";

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
    { _nrfPkg: pkg as DfuPackage | null, installNrfDfu: vi.fn() }
  );
  host._step = "nrf-reset";
  return host;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("nrfDoReset", () => {
  it("logs the touch and the re-enumeration around the 1200 baud reset", async () => {
    const host = readyHost();
    const port = {};
    mocks.requestSerialPort.mockResolvedValue(port);
    await nrfDoReset(asHost(host));
    expect(mocks.resetToBootloader).toHaveBeenCalledWith(port);
    expect(host._log.lines).toEqual([
      "Touching the port at 1200 baud to enter DFU mode",
      "Reset sent; the device re-enumerates as its DFU port",
    ]);
    expect(host._step).toBe("nrf-wait");
  });
});

describe("nrfDoFlash", () => {
  it("streams the engine's step lines into the details log", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashDfuPackageWithReconnect.mockImplementation(
      async (_p, _pkg, onProgress, o) => {
        o.onLog?.("Opening the DFU port at 115200 baud");
        onProgress(50);
        o.onLog?.("Sending the stop packet");
      }
    );
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
    mocks.requestSerialPort.mockResolvedValue({});
    mocks.flashDfuPackageWithReconnect.mockImplementation(
      async (_p, _pkg, _progress, o) => {
        host._device = { ...device, name: "other" } as ConfiguredDevice;
        o.onLog?.("Sending the stop packet");
      }
    );
    await nrfDoFlash(asHost(host));
    expect(host._log.lines).toEqual([]);
  });
});
