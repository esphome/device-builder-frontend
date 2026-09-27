/**
 * @vitest-environment happy-dom
 *
 * A WebSerial connect failure in the boards view must render an error;
 * a cancelled port picker must stay silent (#1414 cross-repo).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/badge/badge.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));

const esptool = vi.hoisted(() => ({
  connectToPort: vi.fn(),
  disconnect: vi.fn(),
  readDeviceManifest: vi.fn(),
}));
const seams = vi.hoisted(() => ({ requestSerialPort: vi.fn(), loadEsptool: vi.fn() }));
vi.mock("../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/util/web-serial.js")>()),
  isWebSerialSupported: () => true,
  requestSerialPort: seams.requestSerialPort,
}));
vi.mock("../../../src/platforms/esp/esptool-loader.js", () => ({
  loadEsptool: seams.loadEsptool,
}));
const banner = vi.hoisted(() => ({
  readBootBanner: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock("../../../src/platforms/boot-banner.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readBootBanner: banner.readBootBanner,
}));

import { defaultLocalize } from "../../../src/common/localize.js";
import { ESPHomeWizardStepBoard } from "../../../src/components/wizard/wizard-step-board.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
async function mount() {
  const el = new ESPHomeWizardStepBoard();
  (el as any)._localize = defaultLocalize;
  (el as any)._api = {
    getBoards: async () => ({ boards: [] }),
    getSerialPorts: async () => [],
  };
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const detectError = (el: ESPHomeWizardStepBoard) =>
  el.shadowRoot!.querySelector(".detect-error");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  seams.requestSerialPort.mockResolvedValue({ getInfo: () => ({}) } as SerialPort);
  // The loaded engine is the hoisted mock itself; the real module never runs.
  seams.loadEsptool.mockResolvedValue(esptool);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wizard-step-board WebSerial detect errors", () => {
  it("renders the connect failure in the boards view", async () => {
    esptool.connectToPort.mockRejectedValueOnce(
      new Error("Failed to connect with the device")
    );
    const el = await mount();

    await (el as any)._connectViaWebSerial();
    await el.updateComplete;

    expect(detectError(el)?.textContent).toContain("Failed to connect with the device");
  });

  it("stays silent when the user cancels the port picker", async () => {
    seams.requestSerialPort.mockResolvedValueOnce(null);
    const el = await mount();

    await (el as any)._connectViaWebSerial();
    await el.updateComplete;

    expect(detectError(el)).toBeNull();
  });

  it("clears a previous error on retry", async () => {
    esptool.connectToPort.mockRejectedValueOnce(new Error("boom"));
    const el = await mount();
    await (el as any)._connectViaWebSerial();
    await el.updateComplete;
    expect(detectError(el)).not.toBeNull();

    esptool.connectToPort.mockResolvedValueOnce({
      chipName: "ESP32-S3",
      transport: {},
      port: {},
      loader: {},
    });
    esptool.readDeviceManifest.mockResolvedValueOnce(null);
    esptool.disconnect.mockResolvedValueOnce(undefined);
    await (el as any)._connectViaWebSerial();
    await el.updateComplete;
    expect(detectError(el)).toBeNull();
  });

  it("names a failed engine chunk fetch", async () => {
    const el = await mount();
    // After mount: the step warms the chunk on connect, which must not eat this.
    seams.loadEsptool.mockRejectedValue(new TypeError("Failed to fetch"));

    await (el as any)._connectViaWebSerial();
    await el.updateComplete;

    expect(detectError(el)?.textContent).toContain(
      defaultLocalize("firmware.engine_load_failed")
    );
    expect(esptool.connectToPort).not.toHaveBeenCalled();
  });

  it("says when the picked device's USB ids name no board it knows", async () => {
    seams.requestSerialPort.mockResolvedValueOnce({
      getInfo: () => ({ usbVendorId: 0x2341, usbProductId: 0x8036 }),
    } as SerialPort);
    const el = await mount();

    await (el as any)._connectViaWebSerial();
    await el.updateComplete;

    expect(detectError(el)?.textContent).toContain("Could not tell which board this is");
    expect(esptool.connectToPort).not.toHaveBeenCalled();
  });

  it("says so when the banner named a board the catalog lacks", async () => {
    banner.readBootBanner.mockResolvedValueOnce({ board: "some-new-kit" });
    seams.requestSerialPort.mockResolvedValueOnce({
      getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
    } as SerialPort);
    const el = await mount();
    (el as any)._api.getBoard = async () => {
      throw new Error("no such board");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await (el as any)._connectViaWebSerial();
    await el.updateComplete;
    warn.mockRestore();

    expect(detectError(el)?.textContent).toContain('calls itself "some-new-kit"');
    expect(esptool.connectToPort).not.toHaveBeenCalled();
  });

  it("says the named board was not found even when the chip narrowed the picker", async () => {
    banner.readBootBanner.mockResolvedValueOnce({
      platform: "rtl87xx",
      mcu: "rtl8720c",
      board: "some-new-kit",
    });
    seams.requestSerialPort.mockResolvedValueOnce({
      getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
    } as SerialPort);
    const el = await mount();
    (el as any)._api.getBoard = async () => {
      throw new Error("no such board");
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await (el as any)._connectViaWebSerial();
    await el.updateComplete;
    warn.mockRestore();

    expect(detectError(el)?.textContent).toContain('calls itself "some-new-kit"');
    expect(el.shadowRoot!.querySelector(".detection-banner")?.textContent).toContain(
      "RTL8720C"
    );

    // Show all boards takes the detection's message with it.
    (el as any)._exitDetectionMode();
    await el.updateComplete;
    expect(detectError(el)).toBeNull();
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
