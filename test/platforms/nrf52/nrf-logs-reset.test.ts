import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  touchPort: vi.fn(async () => {}),
  sleep: vi.fn(async () => {}),
}));
vi.mock("../../../src/util/serial-bootloader-touch.js", () => ({
  touchPort: mocks.touchPort,
}));
vi.mock("../../../src/util/sleep.js", () => ({ sleep: mocks.sleep }));

import {
  nrfResetFailureKey,
  NrfResetIgnoredError,
  rebootNrf,
} from "../../../src/platforms/nrf52/nrf-logs-reset.js";
import { isNrfAppCdcPort } from "../../../src/platforms/nrf52/nrf-platform.js";

function makePort(connected: boolean | undefined = true) {
  const port = Object.assign(new EventTarget(), {
    connected,
    getInfo: () => ({ usbVendorId: 0x2fe3, usbProductId: 0x0100 }),
  });
  return port;
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("rebootNrf", () => {
  it("touches at 2001 baud and returns once the device drops off the bus", async () => {
    const port = makePort();
    // The reboot takes the port away a moment after the touch.
    mocks.sleep.mockImplementationOnce(async () => {
      port.connected = false;
    });
    await expect(rebootNrf(port as unknown as SerialPort, () => false)).resolves.toBe(
      true
    );
    expect(mocks.touchPort).toHaveBeenCalledWith(port, 2001);
  });

  it("sees the drop through the disconnect event where connected is missing", async () => {
    const port = makePort(undefined);
    mocks.touchPort.mockImplementationOnce(async () => {
      port.dispatchEvent(new Event("disconnect"));
    });
    await expect(rebootNrf(port as unknown as SerialPort, () => false)).resolves.toBe(
      true
    );
    expect(mocks.sleep).not.toHaveBeenCalled();
  });

  it("does nothing once the session was cancelled", async () => {
    const port = makePort();
    await expect(rebootNrf(port as unknown as SerialPort, () => true)).resolves.toBe(
      false
    );
    expect(mocks.touchPort).not.toHaveBeenCalled();
  });

  it("gives up when the device never drops (firmware too old to react)", async () => {
    vi.useFakeTimers();
    const port = makePort();
    mocks.sleep.mockImplementation(async () => {
      vi.advanceTimersByTime(100);
    });
    await expect(
      rebootNrf(port as unknown as SerialPort, () => false)
    ).rejects.toBeInstanceOf(NrfResetIgnoredError);
  });
});

describe("nRF52 reset helpers", () => {
  it("names only firmware too old to react; anything else gets the logs' generic key", () => {
    expect(nrfResetFailureKey(new NrfResetIgnoredError())).toBe(
      "firmware.nrf_reset_needs_newer_esphome"
    );
    expect(nrfResetFailureKey(new Error("boom"))).toBeUndefined();
  });

  it("claims only ESPHome's own Zephyr CDC, not a UART bridge", () => {
    expect(isNrfAppCdcPort(makePort() as unknown as SerialPort)).toBe(true);
    const bridge = { getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }) };
    expect(isNrfAppCdcPort(bridge as unknown as SerialPort)).toBe(false);
  });
});
