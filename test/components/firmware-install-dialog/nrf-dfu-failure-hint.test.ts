// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  // Makes the next engine load fail, as a lost lazy chunk would.
  engineLoadFails: false,
  requestSerialPort: vi.fn(),
  resetToBootloader: vi.fn(async () => {}),
  flashDfuPackageWithReconnect: vi.fn(async () => {}),
}));
vi.mock("../../../src/util/web-serial.js", () => ({
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../src/util/serial-bootloader-touch.js", () => ({
  resetToBootloader: mocks.resetToBootloader,
}));
vi.mock("../../../src/util/nrf-dfu.js", () => ({
  // The flow reads this binding right after the lazy import; a throwing read
  // fails the load the way a lost chunk would, before any flash starts.
  get flashDfuPackageWithReconnect() {
    if (mocks.engineLoadFails) throw new Error("chunk load failed");
    return mocks.flashDfuPackageWithReconnect;
  },
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
  // Keep the substitution visible: the key plus its arguments.
  host._localize = ((key: string, args?: Record<string, unknown>) =>
    args ? `${key} ${JSON.stringify(args)}` : key) as typeof host._localize;
  return host;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requestSerialPort.mockResolvedValue({});
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
      'firmware.nrf_manual_bootloader_hint {"error":"Failed to receive ACK after 3 attempts"}'
    );
  });

  it("adds the same hint when the touch itself fails", async () => {
    const host = readyHost();
    mocks.resetToBootloader.mockRejectedValue(
      new DOMException("refused", "NetworkError")
    );
    await nrfDoReset(asHost(host));
    expect(host._step).toBe("error");
    expect(host._errorMessage).toContain("firmware.nrf_manual_bootloader_hint");
  });

  it("drops a trailing period from the browser's message before joining", async () => {
    const host = readyHost();
    mocks.flashDfuPackageWithReconnect.mockRejectedValue(
      new Error("Failed to open serial port.")
    );
    await nrfDoFlash(asHost(host));
    expect(host._errorMessage).toContain('{"error":"Failed to open serial port"}');
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

  it("keeps a failed engine chunk load bare, since the board is not the problem", async () => {
    const host = readyHost();
    mocks.engineLoadFails = true;
    try {
      await nrfDoFlash(asHost(host));
    } finally {
      mocks.engineLoadFails = false;
    }
    expect(host._step).toBe("error");
    expect(host._statusMessage).toBe("firmware.nrf_flash_failed");
    expect(host._errorMessage).toBe("chunk load failed");
  });

  it("keeps a teardown abort bare", async () => {
    const host = readyHost();
    mocks.flashDfuPackageWithReconnect.mockRejectedValue(
      new DOMException("aborted", "AbortError")
    );
    await nrfDoFlash(asHost(host));
    expect(host._errorMessage).toBe("aborted");
  });
});
