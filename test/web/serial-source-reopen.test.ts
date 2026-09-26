// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streamSerialLines: vi.fn(() => async () => {}),
  openLiveSerialPort: vi.fn(),
}));
vi.mock("../../src/util/serial-log-stream.js", () => ({
  streamSerialLines: mocks.streamSerialLines,
}));
vi.mock("../../src/util/serial-reacquire.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openLiveSerialPort: mocks.openLiveSerialPort,
}));

import { SerialLogSource } from "../../src/web/logs/serial-source.js";

const hooks = { onLine: () => {}, onEnd: () => {} } as never;

function ports(info: SerialPortInfo = { usbVendorId: 0x303a, usbProductId: 0x1001 }) {
  const dead = { close: vi.fn(async () => {}) } as unknown as SerialPort;
  const live = {
    setSignals: vi.fn(async () => {}),
    getInfo: () => info,
  } as unknown as SerialPort;
  mocks.openLiveSerialPort.mockResolvedValue(live);
  return { dead, live };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("SerialLogSource reopen line policy", () => {
  // web.esphome.io doesn't know the board's platform, so the rule is by port:
  // an auto-reset circuit (a UART bridge, an Espressif chip) gets the lines
  // dropped; any other native CDC keeps them, since arduino-pico's only
  // transmits with DTR up and ships under many makers' USB ids.
  it.each([
    ["an ESP32-S3's CDC", { usbVendorId: 0x303a, usbProductId: 0x1001 }, true],
    ["a CH340 bridge", { usbVendorId: 0x1a86, usbProductId: 0x7523 }, true],
    ["a Pico's own CDC", { usbVendorId: 0x2e8a, usbProductId: 0xf00a }, false],
    [
      "an Adafruit Feather RP2040 reached through the ESP card",
      { usbVendorId: 0x239a, usbProductId: 0x80f1 },
      false,
    ],
  ])(
    "on a reopen of %s, drops DTR and RTS before streaming: %s",
    async (_n, info, released) => {
      const { dead, live } = ports(info);
      const source = new SerialLogSource(dead, { reset: "rts-pulse" });
      await source.resume(hooks, () => false);
      const setSignals = vi.mocked(live.setSignals);
      if (released) {
        expect(setSignals).toHaveBeenCalledWith({
          dataTerminalReady: false,
          requestToSend: false,
        });
        expect(setSignals.mock.invocationCallOrder[0]).toBeLessThan(
          mocks.streamSerialLines.mock.invocationCallOrder[0]
        );
      } else {
        expect(setSignals).not.toHaveBeenCalled();
      }
      expect(mocks.streamSerialLines).toHaveBeenCalledWith(live, hooks);
    }
  );

  it("honours the policy's line release on a reopen, whatever bridge the kit sits behind", async () => {
    const { dead, live } = ports({ usbVendorId: 0x1234, usbProductId: 1 });
    const source = new SerialLogSource(dead, {
      reset: "rts-pulse",
      releaseLinesAfterOpen: true,
    });
    await source.resume(hooks, () => false);
    expect(live.setSignals).toHaveBeenCalledWith({
      dataTerminalReady: false,
      requestToSend: false,
    });
  });
});
