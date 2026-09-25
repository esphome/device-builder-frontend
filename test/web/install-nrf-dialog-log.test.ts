// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../src/components/process-terminal/process-terminal.js", () => ({}));
vi.mock("../../src/web/install/esphome-web-install-log.js", () => ({}));

const mocks = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  touchIntoBootloader: vi.fn(),
  parseDfuPackage: vi.fn(),
  flashDfuPackageWithReconnect: vi.fn(),
}));
vi.mock("../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../src/util/serial-bootloader-touch.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  touchIntoBootloader: mocks.touchIntoBootloader,
}));
vi.mock("../../src/util/nrf-dfu.js", () => ({
  parseDfuPackage: mocks.parseDfuPackage,
  flashDfuPackageWithReconnect: mocks.flashDfuPackageWithReconnect,
}));

import { identityLocalize } from "../_dom.js";
import { ESPHomeWebInstallNrfDialog } from "../../src/web/install/esphome-web-install-nrf-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function settle(el: ESPHomeWebInstallNrfDialog): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await el.updateComplete;
  }
}

async function mount(): Promise<any> {
  const el = new ESPHomeWebInstallNrfDialog() as any;
  el._localize = identityLocalize;
  el.open = true;
  document.body.appendChild(el);
  await settle(el);
  el._file = new File([new Uint8Array(4)], "firmware.zip");
  return el;
}

const logLines = (el: any): string[] | undefined =>
  (el.shadowRoot!.querySelector("esphome-web-install-log") as any)?.lines;

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
  document.body.innerHTML = "";
  vi.resetAllMocks();
});

describe("web nRF52 install dialog details log", () => {
  it("collects the touch's and the engine's step lines under the card", async () => {
    const el = await mount();
    await el._startInstall();
    await settle(el);
    expect(logLines(el)).toEqual(["Touching the port at 1200 baud"]);
    await el._continueFlash();
    await settle(el);
    expect(el._state).toBe("success");
    expect(logLines(el)).toEqual([
      "Touching the port at 1200 baud",
      "Sending init packet",
    ]);
  });

  it("starts the next run with an empty log", async () => {
    const el = await mount();
    await el._startInstall();
    await settle(el);
    el.open = false;
    await settle(el);
    expect(el._logLines).toEqual([]);
  });
});
