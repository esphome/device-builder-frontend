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

import { identityLocalize, mount } from "../../../_dom.js";
import { ESPHomeWebInstallNrfDialog } from "../../../../src/web/platforms/nrf52/esphome-web-install-nrf-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function mountDialog(): Promise<any> {
  const el = await mount(new ESPHomeWebInstallNrfDialog(), {
    _localize: identityLocalize,
    open: true,
  } as Partial<ESPHomeWebInstallNrfDialog>);
  (el as any)._file = new File([new Uint8Array(4)], "firmware.zip");
  return el;
}

const logLines = (el: any): string[] | undefined =>
  (el.shadowRoot!.querySelector("esphome-install-details-log") as any)?.lines;

beforeEach(() => {
  mocks.requestSerialPort.mockResolvedValue({});
  mocks.parseDfuPackage.mockReturnValue({ parts: [] });
  mocks.touchIntoBootloader.mockImplementation(async ({ onLog }) => {
    onLog?.("Touching the port at 1200 baud");
    return true;
  });
  mocks.flashDfuPackageWithReconnect.mockImplementation(async (_port, _pkg, hooks) => {
    hooks.onLog?.("Sending init packet");
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("esphome-web-install-nrf-dialog details log", () => {
  it("collects the touch's and the engine's step lines under the card", async () => {
    const el = await mountDialog();
    await el._startInstall();
    await el.updateComplete;
    expect(logLines(el)).toEqual(["Touching the port at 1200 baud"]);
    await el._continueFlash();
    await el.updateComplete;
    expect(el._state).toBe("success");
    expect(logLines(el)).toEqual([
      "Touching the port at 1200 baud",
      "Sending init packet",
    ]);
  });

  it("starts a retry with a fresh log without closing the dialog", async () => {
    const el = await mountDialog();
    mocks.flashDfuPackageWithReconnect.mockRejectedValue(new Error("no answer"));
    await el._startInstall();
    await el._continueFlash();
    await el.updateComplete;
    expect(el._state).toBe("error");
    el._state = "idle";
    await el._startInstall();
    await el.updateComplete;
    expect(logLines(el)).toEqual(["Touching the port at 1200 baud"]);
  });

  it("starts the next run with a fresh log", async () => {
    const el = await mountDialog();
    await el._startInstall();
    el.open = false;
    await el.updateComplete;
    el.open = true;
    el._file = new File([new Uint8Array(4)], "firmware.zip");
    await el._startInstall();
    await el.updateComplete;
    expect(logLines(el)).toEqual(["Touching the port at 1200 baud"]);
  });
});
