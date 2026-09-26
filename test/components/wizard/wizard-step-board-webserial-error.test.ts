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
vi.mock("../../../src/platforms/esp/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/platforms/esp/index.js")>()),
  loadEsptool: seams.loadEsptool,
}));
vi.mock("../../../src/platforms/esp/esptool.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/platforms/esp/esptool.js")>()),
  ...esptool,
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
  seams.loadEsptool.mockResolvedValue(esptool as never);
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
    seams.loadEsptool.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await (el as any)._connectViaWebSerial();
    await el.updateComplete;

    expect(detectError(el)?.textContent).toContain(
      defaultLocalize("firmware.engine_load_failed")
    );
    expect(esptool.connectToPort).not.toHaveBeenCalled();
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
