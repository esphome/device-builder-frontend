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

import { detectBoard } from "../../src/platforms/detect-board.js";
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
});
