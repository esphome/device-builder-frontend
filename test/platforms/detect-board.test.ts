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
const banner = vi.hoisted(() => ({
  readBootBanner: vi.fn(async (): Promise<unknown> => null),
}));
vi.mock("../../src/platforms/boot-banner.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readBootBanner: banner.readBootBanner,
}));

import { detectBoard } from "../../src/platforms/detect-board.js";
import {
  SerialOpenTimeoutError,
  SerialPortHeldError,
} from "../../src/util/serial-open-error.js";
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
  banner.readBootBanner.mockResolvedValue(null);
});

describe("detectBoard", () => {
  it("names a Pico or an nRF52 by its USB ids without touching esptool", async () => {
    expect(await detectBoard(port(0x2e8a, 0xf00a))).toEqual({
      kind: "named",
      platform: "rp2",
    });
    expect(await detectBoard(port(0x2fe3, 0x0100))).toEqual({
      kind: "named",
      platform: "nrf52",
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
    expect(await detectBoard(null)).toEqual({ kind: "named", platform: "rp2" });
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

  it("reads the boot banner on a bridge first, and passes what it named through", async () => {
    banner.readBootBanner.mockResolvedValueOnce({
      platform: "rtl87xx",
      mcu: "rtl8720c",
      board: "bw15",
    });
    const bridge = port(0x1a86, 0x7523);
    expect(await detectBoard(bridge)).toEqual({
      kind: "named",
      platform: "rtl87xx",
      mcu: "rtl8720c",
      board: "bw15",
    });
    expect(banner.readBootBanner).toHaveBeenCalledWith(bridge);
    expect(engine.connectToPort).not.toHaveBeenCalled();
  });

  it("reads the boot banner on an ESP-USB-Bridge, as on any other bridge", async () => {
    banner.readBootBanner.mockResolvedValueOnce({ platform: "rtl87xx" });
    const bridge = port(0x303a, 0x1002);
    expect(await detectBoard(bridge)).toEqual({ kind: "named", platform: "rtl87xx" });
    expect(banner.readBootBanner).toHaveBeenCalledWith(bridge);
    expect(engine.connectToPort).not.toHaveBeenCalled();
  });

  it("runs esptool when the banner says ESP, says nothing, or cannot be read", async () => {
    const bridge = port(0x1a86, 0x7523);
    banner.readBootBanner.mockResolvedValueOnce({ platform: "esp" });
    expect(await detectBoard(bridge)).toMatchObject({ kind: "esp" });
    banner.readBootBanner.mockResolvedValueOnce(null);
    expect(await detectBoard(bridge)).toMatchObject({ kind: "esp" });
    banner.readBootBanner.mockRejectedValueOnce(new DOMException("held", "NetworkError"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await detectBoard(bridge)).toMatchObject({ kind: "esp" });
    warn.mockRestore();
    expect(engine.connectToPort).toHaveBeenCalledTimes(3);
  });

  it("never reads a banner on Espressif's own USB", async () => {
    expect(await detectBoard(port(0x303a, 0x1001))).toMatchObject({ kind: "esp" });
    expect(banner.readBootBanner).not.toHaveBeenCalled();
  });

  it("does not hand on a port whose open never came back, or that would not release", async () => {
    banner.readBootBanner.mockRejectedValueOnce(new SerialOpenTimeoutError(3000));
    await expect(detectBoard(port(0x1a86, 0x7523))).rejects.toBeInstanceOf(
      SerialOpenTimeoutError
    );
    banner.readBootBanner.mockRejectedValueOnce(new SerialPortHeldError());
    await expect(detectBoard(port(0x1a86, 0x7523))).rejects.toBeInstanceOf(
      SerialPortHeldError
    );
    expect(engine.connectToPort).not.toHaveBeenCalled();
  });
});
