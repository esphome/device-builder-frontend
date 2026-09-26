import { beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({ requestSerialPort: vi.fn(), loadEsptool: vi.fn() }));
// The loaded engine is this object; the real module never runs.
const engine = vi.hoisted(() => ({
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
vi.mock("../../../src/platforms/esp/esptool-loader.js", () => ({
  loadEsptool: seams.loadEsptool,
}));

import toast from "sonner-js";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { detectAndOpenWizard } from "../../../src/components/dashboard/actions.js";
import { makeUsbPort } from "../../web/_make-web-serial-port.js";

const port = { getInfo: () => ({}) } as SerialPort;
const localize = (k: string) => k;

function makeDialog() {
  return { open: vi.fn(), openWithBoard: vi.fn(), openAtBoardStep: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  seams.requestSerialPort.mockResolvedValue(port);
  seams.loadEsptool.mockResolvedValue(engine);
  engine.connectToPort.mockResolvedValue({
    chipName: "ESP32-S3",
    port,
    loader: {},
    transport: {},
  });
  engine.readDeviceManifest.mockResolvedValue(null);
});

describe("detectAndOpenWizard", () => {
  it("opens the picker in the click without waiting for the engine chunk, then opens the wizard at the board step", async () => {
    const dialog = makeDialog();
    // The chunk stays pending until the pick is in: the fetch overlaps the picker.
    let deliver: (engine: unknown) => void = () => {};
    seams.loadEsptool.mockReturnValueOnce(new Promise((resolve) => (deliver = resolve)));
    seams.requestSerialPort.mockImplementationOnce(async () => {
      deliver(engine);
      return port;
    });
    await detectAndOpenWizard({} as ESPHomeAPI, dialog, { localize });
    expect(engine.connectToPort).toHaveBeenCalledWith(port);
    expect(engine.disconnect).toHaveBeenCalledOnce();
    expect(dialog.openAtBoardStep).toHaveBeenCalledWith({ label: "ESP32-S3" });
  });

  it("recognises a configured device by its MAC and hands it to the caller", async () => {
    const dialog = makeDialog();
    engine.readMacAddress.mockResolvedValue("AA:BB:CC:DD:EE:FF");
    const known = { name: "lamp", mac_address: "aa:bb:cc:dd:ee:ff" } as ConfiguredDevice;
    const onRecognized = vi.fn();
    await detectAndOpenWizard({} as ESPHomeAPI, dialog, {
      localize,
      devices: [known],
      onRecognized,
    });
    expect(onRecognized).toHaveBeenCalledWith(known);
    expect(dialog.open).not.toHaveBeenCalled();
    expect(dialog.openAtBoardStep).not.toHaveBeenCalled();
  });

  it("skips the picker for a port handed in from a connect event", async () => {
    const dialog = makeDialog();
    await detectAndOpenWizard({} as ESPHomeAPI, dialog, { port, localize });
    expect(seams.requestSerialPort).not.toHaveBeenCalled();
    expect(engine.connectToPort).toHaveBeenCalledWith(port);
  });

  it("opens the wizard for a manual pick when the picker is dismissed, quietly", async () => {
    const dialog = makeDialog();
    seams.requestSerialPort.mockResolvedValueOnce(null);
    await detectAndOpenWizard({} as ESPHomeAPI, dialog, { localize });
    expect(engine.connectToPort).not.toHaveBeenCalled();
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
    expect(engine.connectToPort).not.toHaveBeenCalled();
  });

  it("keeps the detection when the release fails", async () => {
    const dialog = makeDialog();
    engine.disconnect.mockRejectedValueOnce(new Error("transport gone"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await detectAndOpenWizard({} as ESPHomeAPI, dialog, { localize, port });
    // A teardown failure never replaces the result; the engine's own
    // disconnect is what closes the port directly.
    expect(dialog.openAtBoardStep).toHaveBeenCalledWith({ label: "ESP32-S3" });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("falls through to the chip family when the board lookup fails, logged", async () => {
    const dialog = makeDialog();
    engine.readDeviceManifest.mockResolvedValue({ board_id: "acme-lamp" });
    const api = { getBoard: vi.fn().mockRejectedValue(new Error("backend down")) };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await detectAndOpenWizard(api as unknown as ESPHomeAPI, dialog, { localize, port });
    expect(dialog.openAtBoardStep).toHaveBeenCalledWith({ label: "ESP32-S3" });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("acme-lamp"),
      expect.any(Error)
    );
    warn.mockRestore();
  });

  it("sends a Pico straight to its platform's boards without the ESP detect (#1856)", async () => {
    const dialog = makeDialog();
    const pico = makeUsbPort(0x2e8a, 0xf00a);
    await detectAndOpenWizard({} as ESPHomeAPI, dialog, { port: pico, localize });
    // rp2 has two chips (RP2040 / RP2350), so the whole platform is the preset.
    expect(dialog.openAtBoardStep).toHaveBeenCalledWith({
      label: "RP2040 / RP2350",
      platform: "rp2",
    });
    expect(engine.connectToPort).not.toHaveBeenCalled();
  });

  it("sends an nRF52 to its one chip", async () => {
    const dialog = makeDialog();
    const nrf = makeUsbPort(0x2fe3, 0x0100);
    await detectAndOpenWizard({} as ESPHomeAPI, dialog, { port: nrf, localize });
    expect(dialog.openAtBoardStep).toHaveBeenCalledWith({ label: "nRF52" });
    expect(engine.connectToPort).not.toHaveBeenCalled();
  });

  it("opens the full picker for a native-USB device of no known family", async () => {
    const dialog = makeDialog();
    const arduino = makeUsbPort(0x2341, 0x8036);
    await detectAndOpenWizard({} as ESPHomeAPI, dialog, { port: arduino, localize });
    expect(dialog.openAtBoardStep).toHaveBeenCalledWith(null);
    expect(engine.connectToPort).not.toHaveBeenCalled();
  });

  it("still detects behind a UART bridge, which can carry any ESP", async () => {
    const dialog = makeDialog();
    const bridge = makeUsbPort(0x1a86, 0x7523);
    await detectAndOpenWizard({} as ESPHomeAPI, dialog, { port: bridge, localize });
    expect(engine.connectToPort).toHaveBeenCalledWith(bridge);
    expect(dialog.openAtBoardStep).toHaveBeenCalledWith({ label: "ESP32-S3" });
  });

  it("classifies a picked port the same way as a plugged-in one", async () => {
    const dialog = makeDialog();
    seams.requestSerialPort.mockResolvedValueOnce(makeUsbPort(0x2e8a, 0xf00a));
    await detectAndOpenWizard({} as ESPHomeAPI, dialog, { localize });
    expect(dialog.openAtBoardStep).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "rp2" })
    );
    expect(engine.connectToPort).not.toHaveBeenCalled();
  });
});
