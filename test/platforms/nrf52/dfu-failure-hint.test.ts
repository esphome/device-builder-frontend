// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  resetToBootloader: vi.fn(),
  flashDfuPackageWithReconnect: vi.fn(),
}));
vi.mock("../../../src/util/web-serial.js", () => ({
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../src/util/serial-bootloader-touch.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resetToBootloader: mocks.resetToBootloader,
}));
vi.mock("../../../src/platforms/nrf52/nrf-dfu.js", () => ({
  flashDfuPackageWithReconnect: mocks.flashDfuPackageWithReconnect,
}));

import { argsLocalize } from "../../_dom.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { nrfDoFlash, nrfDoReset } from "../../../src/platforms/nrf52/dfu-install.js";
import type { DfuPackage } from "../../../src/platforms/nrf52/nrf-dfu.js";
import { BootloaderTouchError } from "../../../src/util/serial-bootloader-touch.js";
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
    { _nrfPkg: pkg as DfuPackage | null, installNrfDfu: vi.fn() }
  );
  host._step = "nrf-reset";
  host._localize = argsLocalize as typeof host._localize;
  return host;
}

beforeEach(() => {
  mocks.requestSerialPort.mockResolvedValue({});
  mocks.resetToBootloader.mockResolvedValue(undefined);
  mocks.flashDfuPackageWithReconnect.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("nRF52 DFU failure hints", () => {
  it("tells the user to enter the bootloader by hand when the bootloader never answers", async () => {
    const host = readyHost();
    mocks.flashDfuPackageWithReconnect.mockRejectedValue(
      new Error("Failed to receive ACK after 3 attempts")
    );
    await nrfDoFlash(asHost(host));
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.nrf_flash_failed");
    expect(host._errorMessage).toBe(
      "firmware.nrf_manual_bootloader_hint | Failed to receive ACK after 3 attempts"
    );
  });

  it("adds the same hint when the touch itself fails", async () => {
    const host = readyHost();
    mocks.resetToBootloader.mockRejectedValue(
      new BootloaderTouchError(new DOMException("refused", "NetworkError"))
    );
    await nrfDoReset(asHost(host));
    expect(host._step).toBe("error");
    expect(host._errorMessage).toBe("firmware.nrf_manual_bootloader_hint | refused");
  });

  it("keeps a picker or permission failure bare, since the board is not the problem", async () => {
    const host = readyHost();
    mocks.requestSerialPort.mockRejectedValue(
      new DOMException("denied", "SecurityError")
    );
    await nrfDoReset(asHost(host));
    expect(host._step).toBe("error");
    expect(host._errorMessage).toBe("denied");
  });
});
