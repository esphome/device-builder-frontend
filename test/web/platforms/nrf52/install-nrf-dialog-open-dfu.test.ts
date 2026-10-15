// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../../../src/components/install-details-log.js", () => ({}));

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  touchIntoBootloader: vi.fn(),
  parseDfuPackage: vi.fn(),
  flashDfuPackageWithReconnect: vi.fn(),
  flashSecureDfuPackage: vi.fn(),
}));
vi.mock("../../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../../../src/util/serial-bootloader-touch.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  touchIntoBootloader: mocks.touchIntoBootloader,
}));
vi.mock("../../../../src/platforms/nrf52/nrf-dfu.js", () => ({
  parseDfuPackage: mocks.parseDfuPackage,
  flashDfuPackageWithReconnect: mocks.flashDfuPackageWithReconnect,
}));
vi.mock("../../../../src/platforms/nrf52/nrf-secure-dfu.js", () => ({
  flashSecureDfuPackage: mocks.flashSecureDfuPackage,
}));

import { makeUsbPort } from "../../_make-web-serial-port.js";
import { pickFile } from "../../_pick-file.js";
import { argsLocalize, mount } from "../../../_dom.js";
import { ESPHomeWebInstallNrfDialog } from "../../../../src/web/platforms/nrf52/esphome-web-install-nrf-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

const application = {
  parts: [
    { type: "application", mode: 4, bin: new Uint8Array(8), dat: new Uint8Array(2) },
  ],
};
const bootloaderPort = makeUsbPort(0x1915, 0x521f);
const adafruitPort = makeUsbPort(0x239a, 0x0029);

async function mountDialog(): Promise<any> {
  const el = (await mount(new ESPHomeWebInstallNrfDialog(), {
    _localize: argsLocalize,
    open: true,
  } as Partial<ESPHomeWebInstallNrfDialog>)) as any;
  await pickFile(el, "_package", new File([new Uint8Array(4)], "firmware.zip"));
  await el._startInstall();
  return el;
}

beforeEach(() => {
  mocks.parseDfuPackage.mockReturnValue(application);
  mocks.touchIntoBootloader.mockResolvedValue(true);
  mocks.flashDfuPackageWithReconnect.mockResolvedValue(undefined);
  mocks.flashSecureDfuPackage.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("esphome-web-install-nrf-dialog with the Open DFU bootloader", () => {
  it("flashes a port with Nordic's bootloader ids over Secure DFU", async () => {
    mocks.requestSerialPort.mockResolvedValue(bootloaderPort);
    const el = await mountDialog();
    await el._continueFlash();
    expect(el._state).toBe("success");
    expect(mocks.flashSecureDfuPackage).toHaveBeenCalledWith(
      bootloaderPort,
      application,
      expect.objectContaining({ onProgress: expect.any(Function) })
    );
    expect(mocks.flashDfuPackageWithReconnect).not.toHaveBeenCalled();
  });

  it("keeps any other port on legacy DFU", async () => {
    mocks.requestSerialPort.mockResolvedValue(adafruitPort);
    const el = await mountDialog();
    await el._continueFlash();
    expect(el._state).toBe("success");
    expect(mocks.flashDfuPackageWithReconnect).toHaveBeenCalledWith(
      adafruitPort,
      application,
      expect.anything()
    );
    expect(mocks.flashSecureDfuPackage).not.toHaveBeenCalled();
  });

  it("names the dongle's RESET button when Secure DFU fails", async () => {
    mocks.requestSerialPort.mockResolvedValue(bootloaderPort);
    mocks.flashSecureDfuPackage.mockRejectedValue(new Error("no answer to the ping"));
    const el = await mountDialog();
    await el._continueFlash();
    expect(el._state).toBe("error");
    expect(el._errorMessage).toBe(
      "web.nrf.install_error_flash | firmware.nrf_open_manual_bootloader_hint | no answer to the ping"
    );
  });

  it("refuses a package Secure DFU cannot take before touching the port", async () => {
    mocks.requestSerialPort.mockResolvedValue(bootloaderPort);
    mocks.parseDfuPackage.mockReturnValue({
      parts: [
        { type: "softdevice", mode: 1, bin: new Uint8Array(8), dat: new Uint8Array(2) },
        { type: "application", mode: 4, bin: new Uint8Array(8), dat: new Uint8Array(2) },
      ],
    });
    const el = await mountDialog();
    await el._continueFlash();
    expect(el._state).toBe("error");
    expect(el._errorMessage).toMatch(
      /^firmware\.nrf_bad_package: the package holds softdevice \+ application/
    );
    expect(mocks.flashSecureDfuPackage).not.toHaveBeenCalled();
    expect(mocks.flashDfuPackageWithReconnect).not.toHaveBeenCalled();
  });
});
