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

const wsSerial = vi.hoisted(() => ({
  detectChip: vi.fn(),
  disconnect: vi.fn(),
  isWebSerialSupported: () => true,
  readDeviceManifest: vi.fn(),
}));
// Keep the rest of the module real — notably the genuine isPortPickerCancel
// driving the cancel-vs-fail split under test.
vi.mock("../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/util/web-serial.js")>()),
  ...wsSerial,
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wizard-step-board WebSerial detect errors", () => {
  it("renders the connect failure in the boards view", async () => {
    wsSerial.detectChip.mockRejectedValueOnce(
      new Error("Failed to connect with the device")
    );
    const el = await mount();

    await (el as any)._connectViaWebSerial();
    await el.updateComplete;

    expect(detectError(el)?.textContent).toContain("Failed to connect with the device");
  });

  it("stays silent when the user cancels the port picker", async () => {
    wsSerial.detectChip.mockRejectedValueOnce(
      new DOMException("No port selected by the user.", "NotFoundError")
    );
    const el = await mount();

    await (el as any)._connectViaWebSerial();
    await el.updateComplete;

    expect(detectError(el)).toBeNull();
  });

  it("clears a previous error on retry", async () => {
    wsSerial.detectChip.mockRejectedValueOnce(new Error("boom"));
    const el = await mount();
    await (el as any)._connectViaWebSerial();
    await el.updateComplete;
    expect(detectError(el)).not.toBeNull();

    wsSerial.detectChip.mockResolvedValueOnce({
      chipName: "ESP32-S3",
      transport: {},
      port: {},
      loader: {},
    });
    wsSerial.readDeviceManifest.mockResolvedValueOnce(null);
    wsSerial.disconnect.mockResolvedValueOnce(undefined);
    await (el as any)._connectViaWebSerial();
    await el.updateComplete;
    expect(detectError(el)).toBeNull();
  });
});
/* eslint-enable @typescript-eslint/no-explicit-any */
