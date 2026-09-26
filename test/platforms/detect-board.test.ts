import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({ requestSerialPort: vi.fn(), loadEsptool: vi.fn() }));
const engine = vi.hoisted(() => ({
  connectToPort: vi.fn(),
  readMacAddress: vi.fn(),
  readDeviceManifest: vi.fn(),
  disconnect: vi.fn(async () => {}),
}));
vi.mock("../../src/util/web-serial.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/util/web-serial.js")>()),
  requestSerialPort: seams.requestSerialPort,
}));
vi.mock("../../src/platforms/esp/esptool-loader.js", () => ({
  loadEsptool: seams.loadEsptool,
}));
const rtl = vi.hoisted(() => ({ probeAmbz2: vi.fn(async () => false) }));
vi.mock("../../src/platforms/rtl87xx/index.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadAmbz2Engine: async () => rtl,
}));

import { detectBoard } from "../../src/platforms/detect-board.js";
import { UnsupportedChipError } from "../../src/platforms/esp/esp-usb.js";
import { SerialConnectTimeoutError } from "../../src/util/serial-open-error.js";
import { makeUsbPort as port } from "../web/_make-web-serial-port.js";

beforeEach(() => {
  seams.loadEsptool.mockResolvedValue(engine);
  engine.connectToPort.mockImplementation(async (p: SerialPort) => ({
    chipName: "ESP32-S3",
    port: p,
    loader: {},
    transport: {},
  }));
  engine.readDeviceManifest.mockResolvedValue(null);
});

afterEach(() => {
  vi.clearAllMocks();
  rtl.probeAmbz2.mockResolvedValue(false);
});

describe("detectBoard", () => {
  it("names a Pico or an nRF52 by its USB ids without touching esptool", async () => {
    expect(await detectBoard(port(0x2e8a, 0xf00a))).toEqual({
      kind: "family",
      family: "rp2",
    });
    expect(await detectBoard(port(0x2fe3, 0x0100))).toEqual({
      kind: "family",
      family: "nrf52",
    });
    expect(engine.connectToPort).not.toHaveBeenCalled();
  });

  it("gives up on a native-USB device of no known family, since esptool would stall on it", async () => {
    expect(await detectBoard(port(0x2341, 0x8036))).toEqual({ kind: "unknown" });
    expect(engine.connectToPort).not.toHaveBeenCalled();
  });

  it("runs the ESP detect on Espressif's own USB, a bridge, and an id-less port", async () => {
    for (const p of [port(0x303a, 0x1001), port(0x1a86, 0x7523), port()]) {
      const detection = await detectBoard(p);
      expect(detection).toEqual({
        kind: "esp",
        board: { chipName: "ESP32-S3", mac: null, manifest: null },
      });
      expect(engine.connectToPort).toHaveBeenLastCalledWith(p);
    }
  });

  it("picks a port when none is in hand, and classifies it the same way", async () => {
    seams.requestSerialPort.mockResolvedValueOnce(port(0x2e8a, 0xf00a));
    expect(await detectBoard(null)).toEqual({ kind: "family", family: "rp2" });
    expect(engine.connectToPort).not.toHaveBeenCalled();
  });

  it("is null when the picker is dismissed", async () => {
    seams.requestSerialPort.mockResolvedValueOnce(null);
    expect(await detectBoard(null)).toBeNull();
  });

  it("lets the ESP path's failures through untouched", async () => {
    engine.connectToPort.mockRejectedValueOnce(new Error("no sync"));
    await expect(detectBoard(port(0x1a86, 0x7523))).rejects.toThrow("no sync");
  });

  it("asks for an RTL8720C behind a bridge once esptool gave up, and names its chip", async () => {
    engine.connectToPort.mockRejectedValueOnce(
      new Error("Failed to connect with the device")
    );
    rtl.probeAmbz2.mockResolvedValueOnce(true);
    const bridge = port(0x1a86, 0x7523);
    expect(await detectBoard(bridge)).toEqual({
      kind: "family",
      family: "rtl87xx",
      chip: "rtl8720c",
    });
    // esptool first: its reset is harmless to an RTL kit, the reverse is not.
    expect(engine.connectToPort).toHaveBeenCalledWith(bridge);
    expect(rtl.probeAmbz2).toHaveBeenCalledWith(bridge, expect.anything());
  });

  it("keeps esptool's failure when the probe hears nothing", async () => {
    engine.connectToPort.mockRejectedValueOnce(
      new Error("Failed to connect with the device")
    );
    await expect(detectBoard(port(0x1a86, 0x7523))).rejects.toThrow(
      "Failed to connect with the device"
    );
    expect(rtl.probeAmbz2).toHaveBeenCalledOnce();
  });

  it("never probes Espressif's own USB, an unsupported chip, or a timed-out port", async () => {
    engine.connectToPort.mockRejectedValueOnce(new Error("no sync"));
    await expect(detectBoard(port(0x303a, 0x1001))).rejects.toThrow("no sync");
    engine.connectToPort.mockRejectedValueOnce(new UnsupportedChipError("ESP32-H21"));
    await expect(detectBoard(port(0x1a86, 0x7523))).rejects.toBeInstanceOf(
      UnsupportedChipError
    );
    engine.connectToPort.mockRejectedValueOnce(new SerialConnectTimeoutError(30_000));
    await expect(detectBoard(port(0x1a86, 0x7523))).rejects.toBeInstanceOf(
      SerialConnectTimeoutError
    );
    expect(rtl.probeAmbz2).not.toHaveBeenCalled();
  });
});
