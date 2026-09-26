import { beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
  requestSerialPort: vi.fn(),
  loadEsptool: vi.fn(),
  connectToPort: vi.fn(),
  readMacAddress: vi.fn(),
  readDeviceManifest: vi.fn(),
  disconnect: vi.fn(async () => {}),
}));
vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/util/web-serial.js")>()),
  requestSerialPort: seams.requestSerialPort,
}));
vi.mock("../../../src/platforms/esp/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/platforms/esp/index.js")>()),
  loadEsptool: seams.loadEsptool,
}));

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import { detectAndOpenWizard } from "../../../src/components/dashboard/actions.js";

const engine = {
  connectToPort: seams.connectToPort,
  readMacAddress: seams.readMacAddress,
  readDeviceManifest: seams.readDeviceManifest,
  disconnect: seams.disconnect,
};
const port = { getInfo: () => ({}) } as SerialPort;
const localize = (k: string) => k;

function makeDialog() {
  return { open: vi.fn(), openWithBoard: vi.fn(), openAtBoardStep: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  seams.requestSerialPort.mockResolvedValue(port);
  seams.loadEsptool.mockResolvedValue(engine);
  seams.connectToPort.mockResolvedValue({
    chipName: "ESP32-S3",
    port,
    loader: {},
    transport: {},
  });
  seams.readDeviceManifest.mockResolvedValue(null);
});

describe("detectAndOpenWizard", () => {
  it("picks the port first, then loads the engine and opens the wizard at the board step", async () => {
    const dialog = makeDialog();
    await detectAndOpenWizard({} as ESPHomeAPI, dialog, { localize });
    expect(seams.requestSerialPort.mock.invocationCallOrder[0]).toBeLessThan(
      seams.loadEsptool.mock.invocationCallOrder[0]
    );
    expect(seams.connectToPort).toHaveBeenCalledWith(port);
    expect(seams.disconnect).toHaveBeenCalledOnce();
    expect(dialog.openAtBoardStep).toHaveBeenCalledWith("ESP32-S3");
  });

  it("skips the picker for a port handed in from a connect event", async () => {
    const dialog = makeDialog();
    await detectAndOpenWizard({} as ESPHomeAPI, dialog, { port, localize });
    expect(seams.requestSerialPort).not.toHaveBeenCalled();
    expect(seams.connectToPort).toHaveBeenCalledWith(port);
  });

  it("opens the wizard for a manual pick when the picker is dismissed, quietly", async () => {
    const dialog = makeDialog();
    seams.requestSerialPort.mockResolvedValueOnce(null);
    await detectAndOpenWizard({} as ESPHomeAPI, dialog, { localize });
    expect(seams.loadEsptool).not.toHaveBeenCalled();
    expect(dialog.open).toHaveBeenCalledWith("board");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("names a failed engine chunk fetch and still opens the wizard", async () => {
    const dialog = makeDialog();
    seams.loadEsptool.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await detectAndOpenWizard({} as ESPHomeAPI, dialog, { localize });
    expect(toast.error).toHaveBeenCalledWith(
      "firmware.engine_load_failed",
      expect.anything()
    );
    expect(dialog.open).toHaveBeenCalledWith("board");
    expect(seams.connectToPort).not.toHaveBeenCalled();
  });
});
