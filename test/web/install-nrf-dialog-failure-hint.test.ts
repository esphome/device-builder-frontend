// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../src/components/install-details-log.js", () => ({}));

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  touchIntoBootloader: vi.fn(),
  parseDfuPackage: vi.fn(),
  flashDfuPackageWithReconnect: vi.fn(),
}));
// The flash step picks the DFU port itself.
vi.mock("../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../src/util/serial-bootloader-touch.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  touchIntoBootloader: mocks.touchIntoBootloader,
}));
vi.mock("../../src/platforms/nrf52/nrf-dfu.js", () => ({
  parseDfuPackage: mocks.parseDfuPackage,
  flashDfuPackageWithReconnect: mocks.flashDfuPackageWithReconnect,
}));

import { argsLocalize } from "../_dom.js";
import { BootloaderTouchError } from "../../src/util/serial-bootloader-touch.js";
import { ESPHomeWebInstallNrfDialog } from "../../src/web/install/esphome-web-install-nrf-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// Driven directly: nothing here reads the rendered output.
function dialog(): any {
  const el = new ESPHomeWebInstallNrfDialog() as any;
  el._localize = argsLocalize;
  el._file = new File([new Uint8Array(4)], "firmware.zip");
  return el;
}

beforeEach(() => {
  mocks.requestSerialPort.mockResolvedValue({});
  mocks.touchIntoBootloader.mockResolvedValue(true);
  mocks.parseDfuPackage.mockReturnValue({ parts: [] });
  mocks.flashDfuPackageWithReconnect.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("web nRF52 install dialog failure hints", () => {
  it("tells the user to enter the bootloader by hand when the bootloader never answers", async () => {
    const el = dialog();
    await el._startInstall();
    expect(el._state).toBe("waiting");
    mocks.flashDfuPackageWithReconnect.mockRejectedValue(
      new Error("Failed to receive ACK after 3 attempts")
    );
    await el._continueFlash();
    expect(el._state).toBe("error");
    expect(el._errorMessage).toBe(
      "web.nrf.install_error_flash | firmware.nrf_manual_bootloader_hint | Failed to receive ACK after 3 attempts"
    );
  });

  it("adds the same hint when the touch itself fails", async () => {
    const el = dialog();
    mocks.touchIntoBootloader.mockRejectedValue(
      new BootloaderTouchError(new DOMException("refused", "NetworkError"))
    );
    await el._startInstall();
    expect(el._state).toBe("error");
    expect(el._errorMessage).toBe(
      "web.connect.failed | firmware.nrf_manual_bootloader_hint | refused"
    );
  });

  it("goes back to the setup step when the picker is dismissed", async () => {
    const el = dialog();
    mocks.touchIntoBootloader.mockResolvedValue(false);
    await el._startInstall();
    expect(el._state).toBe("idle");
  });

  it("keeps a picker or permission failure bare, since the board is not the problem", async () => {
    const el = dialog();
    mocks.touchIntoBootloader.mockRejectedValue(
      new DOMException("denied", "SecurityError")
    );
    await el._startInstall();
    expect(el._state).toBe("error");
    expect(el._errorMessage).toBe("web.connect.failed | denied");
  });
});
