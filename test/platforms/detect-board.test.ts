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
import {
  NoEspAnswerError,
  UnsupportedChipError,
} from "../../src/platforms/esp/esp-usb.js";
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
});

describe("detectBoard", () => {
  it("names a Pico or an nRF52 by its USB ids without touching esptool", async () => {
    expect(await detectBoard(port(0x2e8a, 0xf00a))).toEqual({
      kind: "family",
      platform: "rp2",
    });
    expect(await detectBoard(port(0x2fe3, 0x0100))).toEqual({
      kind: "family",
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
    expect(await detectBoard(null)).toEqual({ kind: "family", platform: "rp2" });
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

  it("lets the platforms probe a bridge once no ESP answered, and names the chip", async () => {
    engine.connectToPort.mockRejectedValueOnce(
      new NoEspAnswerError(new Error("Failed to connect with the device"))
    );
    rtl.probeAmbz2.mockResolvedValueOnce(true);
    const bridge = port(0x1a86, 0x7523);
    expect(await detectBoard(bridge)).toEqual({
      kind: "family",
      platform: "rtl87xx",
      mcu: "rtl8720c",
    });
    // esptool first: its reset is harmless to an RTL kit, the reverse is not.
    expect(engine.connectToPort).toHaveBeenCalledWith(bridge);
    expect(rtl.probeAmbz2).toHaveBeenCalledWith(bridge, expect.anything());
  });

  it("keeps esptool's failure when no probe answers", async () => {
    engine.connectToPort.mockRejectedValueOnce(
      new NoEspAnswerError(new Error("Failed to connect with the device"))
    );
    await expect(detectBoard(port(0x1a86, 0x7523))).rejects.toBeInstanceOf(
      NoEspAnswerError
    );
    expect(rtl.probeAmbz2).toHaveBeenCalledOnce();
  });

  it("probes only after a no-answer, and never on Espressif's own USB", async () => {
    engine.connectToPort.mockRejectedValueOnce(
      new NoEspAnswerError(new Error("Failed to connect with the device"))
    );
    await expect(detectBoard(port(0x303a, 0x1001))).rejects.toBeInstanceOf(
      NoEspAnswerError
    );
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

  it("gives up on a probe that never settles and keeps esptool's failure", async () => {
    vi.useFakeTimers();
    try {
      engine.connectToPort.mockRejectedValueOnce(
        new NoEspAnswerError(new Error("Failed to connect with the device"))
      );
      rtl.probeAmbz2.mockReturnValueOnce(new Promise(() => {}));
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = detectBoard(port(0x1a86, 0x7523));
      const assertion = expect(result).rejects.toBeInstanceOf(NoEspAnswerError);
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Gave up on the probe"),
        expect.any(Error)
      );
      // The session was told to stop first, before the outer deadline fired.
      const [, hooks] = rtl.probeAmbz2.mock.calls[0] as unknown as [
        SerialPort,
        { signal: AbortSignal },
      ];
      expect(hooks.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
