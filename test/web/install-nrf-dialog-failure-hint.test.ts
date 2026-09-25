// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/base-dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/button/button.js", () => ({}));
vi.mock("../../src/components/process-terminal/process-terminal.js", () => ({}));

const mocks = vi.hoisted(() => ({
  // Makes the next engine load fail, as a lost lazy chunk would.
  engineLoadFails: false,
  requestSerialPort: vi.fn(),
  resetToBootloader: vi.fn(async () => {}),
  parseDfuPackage: vi.fn(() => ({ parts: [] })),
  flashDfuPackageWithReconnect: vi.fn(async () => {}),
}));
vi.mock("../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requestSerialPort: mocks.requestSerialPort,
}));
vi.mock("../../src/util/serial-bootloader-touch.js", () => ({
  resetToBootloader: mocks.resetToBootloader,
}));
vi.mock("../../src/util/nrf-dfu.js", () => ({
  parseDfuPackage: mocks.parseDfuPackage,
  // The dialog reads this binding right after the lazy import; a throwing
  // read fails the load the way a lost chunk would, before any flash starts.
  get flashDfuPackageWithReconnect() {
    if (mocks.engineLoadFails) throw new Error("chunk load failed");
    return mocks.flashDfuPackageWithReconnect;
  },
}));

import { ESPHomeWebInstallNrfDialog } from "../../src/web/install/esphome-web-install-nrf-dialog.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function settle(el: ESPHomeWebInstallNrfDialog): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
    await el.updateComplete;
  }
}

// The key plus its arguments, so the joined hint stays visible.
const localize = (key: string, args?: Record<string, unknown>) =>
  args ? `${key} ${JSON.stringify(args)}` : key;

async function mount(): Promise<ESPHomeWebInstallNrfDialog> {
  const el = new ESPHomeWebInstallNrfDialog();
  (el as any)._localize = localize;
  el.open = true;
  document.body.appendChild(el);
  await settle(el);
  (el as any)._file = new File([new Uint8Array(4)], "firmware.zip");
  return el;
}

const startInstall = async (el: ESPHomeWebInstallNrfDialog) => {
  await (el as any)._startInstall();
  await settle(el);
};
const continueFlash = async (el: ESPHomeWebInstallNrfDialog) => {
  await (el as any)._continueFlash();
  await settle(el);
};
const state = (el: ESPHomeWebInstallNrfDialog) => (el as any)._state as string;
const errorMessage = (el: ESPHomeWebInstallNrfDialog) =>
  (el as any)._errorMessage as string;

beforeEach(() => {
  mocks.requestSerialPort.mockResolvedValue({});
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("web nRF52 install dialog failure hints", () => {
  it("tells the user to enter the bootloader by hand when the bootloader never answers", async () => {
    const el = await mount();
    await startInstall(el);
    expect(state(el)).toBe("waiting");
    mocks.flashDfuPackageWithReconnect.mockRejectedValue(
      new Error("Failed to receive ACK after 3 attempts")
    );
    await continueFlash(el);
    expect(state(el)).toBe("error");
    expect(errorMessage(el)).toBe(
      'web.nrf.install_error_flash {"error":"web.nrf.install_manual_bootloader_hint {\\"error\\":\\"Failed to receive ACK after 3 attempts\\"}"}'
    );
  });

  it("adds the same hint when the touch itself fails", async () => {
    const el = await mount();
    mocks.resetToBootloader.mockRejectedValue(
      new DOMException("refused", "NetworkError")
    );
    await startInstall(el);
    expect(state(el)).toBe("error");
    expect(errorMessage(el)).toContain("web.connect.failed");
    expect(errorMessage(el)).toContain("web.nrf.install_manual_bootloader_hint");
  });

  it("drops a trailing period from the browser's message before joining", async () => {
    const el = await mount();
    await startInstall(el);
    mocks.flashDfuPackageWithReconnect.mockRejectedValue(
      new Error("Failed to open serial port.")
    );
    await continueFlash(el);
    expect(errorMessage(el)).toContain('\\"error\\":\\"Failed to open serial port\\"');
  });

  it("goes back to idle when the picker is dismissed", async () => {
    const el = await mount();
    mocks.requestSerialPort.mockResolvedValue(null);
    await startInstall(el);
    expect(state(el)).toBe("idle");
    expect(mocks.resetToBootloader).not.toHaveBeenCalled();
  });

  it("keeps a picker or permission failure bare, since the board is not the problem", async () => {
    const el = await mount();
    mocks.requestSerialPort.mockRejectedValue(
      new DOMException("denied", "SecurityError")
    );
    await startInstall(el);
    expect(state(el)).toBe("error");
    expect(errorMessage(el)).toBe('web.connect.failed {"error":"denied"}');
  });

  it("keeps a failed engine chunk load bare, since the board is not the problem", async () => {
    const el = await mount();
    await startInstall(el);
    mocks.engineLoadFails = true;
    try {
      await continueFlash(el);
    } finally {
      mocks.engineLoadFails = false;
    }
    expect(state(el)).toBe("error");
    expect(errorMessage(el)).toBe(
      'web.nrf.install_error_flash {"error":"chunk load failed"}'
    );
  });

  it("keeps a teardown abort bare", async () => {
    const el = await mount();
    await startInstall(el);
    mocks.flashDfuPackageWithReconnect.mockRejectedValue(
      new DOMException("aborted", "AbortError")
    );
    await continueFlash(el);
    expect(errorMessage(el)).toBe('web.nrf.install_error_flash {"error":"aborted"}');
  });
});
