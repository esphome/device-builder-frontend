import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  touchPort: vi.fn(async () => {}),
  openLiveSerialPort: vi.fn(),
  sleep: vi.fn(async () => {}),
}));
vi.mock("../../../src/util/serial-bootloader-touch.js", () => ({
  touchPort: mocks.touchPort,
}));
vi.mock("../../../src/util/serial-reacquire.js", () => ({
  openLiveSerialPort: mocks.openLiveSerialPort,
}));
vi.mock("../../../src/util/sleep.js", () => ({ sleep: mocks.sleep }));

import {
  isNrfAppCdcPort,
  NRF_RESET_BAUD_RATE,
  nrfResetFailureKey,
  NrfResetIgnoredError,
  rebootNrf,
  resetNrfForLogs,
} from "../../../src/platforms/nrf52/nrf-logs-reset.js";

function makePort(connected = true) {
  return { connected, getInfo: () => ({ usbVendorId: 0x2fe3, usbProductId: 0x0100 }) };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("nRF52 logs reset", () => {
  it("touches at 2001 baud and returns once the device drops off the bus", async () => {
    const port = makePort();
    // The reboot takes the port away a moment after the touch.
    mocks.sleep.mockImplementationOnce(async () => {
      port.connected = false;
    });
    await expect(rebootNrf(port as unknown as SerialPort, () => false)).resolves.toBe(
      true
    );
    expect(mocks.touchPort).toHaveBeenCalledWith(port, NRF_RESET_BAUD_RATE);
    expect(NRF_RESET_BAUD_RATE).toBe(2001);
  });

  it("does nothing once the session was cancelled", async () => {
    const port = makePort();
    await expect(rebootNrf(port as unknown as SerialPort, () => true)).resolves.toBe(
      false
    );
    expect(mocks.touchPort).not.toHaveBeenCalled();
  });

  it("names firmware too old to react when the device never drops", async () => {
    vi.useFakeTimers();
    const port = makePort();
    mocks.sleep.mockImplementation(async () => {
      vi.advanceTimersByTime(100);
    });
    const err = await rebootNrf(port as unknown as SerialPort, () => false).catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(NrfResetIgnoredError);
    expect(nrfResetFailureKey(err, "plain")).toBe(
      "firmware.nrf_reset_needs_newer_esphome"
    );
    expect(nrfResetFailureKey(new Error("boom"), "plain")).toBe("plain");
  });

  it("reopens the port at the logs baud after the reboot", async () => {
    const port = makePort(false);
    const live = makePort();
    mocks.openLiveSerialPort.mockResolvedValue(live);
    const cancelled = () => false;
    await expect(
      resetNrfForLogs(port as unknown as SerialPort, 115200, cancelled)
    ).resolves.toBe(live);
    expect(mocks.openLiveSerialPort).toHaveBeenCalledWith(port, {
      baudRate: 115200,
      cancelled,
    });
  });

  it("claims only ESPHome's own Zephyr CDC, not a UART bridge", () => {
    expect(isNrfAppCdcPort(makePort() as unknown as SerialPort)).toBe(true);
    const bridge = { getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }) };
    expect(isNrfAppCdcPort(bridge as unknown as SerialPort)).toBe(false);
  });
});
