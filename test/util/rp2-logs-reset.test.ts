import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resetToBootloader: vi.fn<(port: SerialPort) => Promise<void>>(),
  getPicobootDevices: vi.fn<() => Promise<USBDevice[]>>(),
  requestPicobootDevice: vi.fn<() => Promise<USBDevice | null>>(),
  openLiveSerialPort: vi.fn<() => Promise<SerialPort | null>>(),
  open: vi.fn<(usb: USBDevice) => Promise<unknown>>(),
  reboot: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => Promise<void>>(),
}));

vi.mock("../../src/util/serial-bootloader-touch.js", () => ({
  resetToBootloader: mocks.resetToBootloader,
}));
vi.mock("../../src/util/web-usb.js", () => ({
  getPicobootDevices: mocks.getPicobootDevices,
  loadPicoboot: async () => ({ PicobootDevice: { open: mocks.open } }),
  requestPicobootDevice: mocks.requestPicobootDevice,
}));
vi.mock("../../src/util/web-serial.js", () => ({
  openLiveSerialPort: mocks.openLiveSerialPort,
}));

import { PicoStrandedError, resetPicoForLogs } from "../../src/util/rp2-logs-reset.js";

const port = { getInfo: () => ({}) } as unknown as SerialPort;
const live = { readable: {} } as unknown as SerialPort;
const usb = { vendorId: 0x2e8a, productId: 3 } as USBDevice;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.resetToBootloader.mockResolvedValue(undefined);
  mocks.getPicobootDevices.mockResolvedValue([]);
  mocks.requestPicobootDevice.mockResolvedValue(usb);
  mocks.openLiveSerialPort.mockResolvedValue(live);
  mocks.open.mockResolvedValue({ reboot: mocks.reboot, close: mocks.close });
  mocks.reboot.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function run(): Promise<SerialPort | null> {
  const result = resetPicoForLogs(port, 115200);
  // Silence the rejection until the test inspects it; the poll below needs
  // the timers advanced either way.
  result.catch(() => {});
  await vi.runAllTimersAsync();
  return result;
}

describe("resetPicoForLogs", () => {
  it("touches, reboots a granted bootloader without the chooser, and reopens the port", async () => {
    mocks.getPicobootDevices.mockResolvedValue([usb]);
    await expect(run()).resolves.toBe(live);
    expect(mocks.resetToBootloader).toHaveBeenCalledWith(port);
    expect(mocks.requestPicobootDevice).not.toHaveBeenCalled();
    expect(mocks.open).toHaveBeenCalledWith(usb);
    expect(mocks.reboot).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.openLiveSerialPort).toHaveBeenCalledWith(port, { baudRate: 115200 });
  });

  it("falls back to the chooser when no granted bootloader appears in time", async () => {
    await expect(run()).resolves.toBe(live);
    expect(mocks.getPicobootDevices.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.requestPicobootDevice).toHaveBeenCalledOnce();
    expect(mocks.reboot).toHaveBeenCalledOnce();
  });

  it("reports the Pico stranded when the chooser is dismissed", async () => {
    mocks.requestPicobootDevice.mockResolvedValue(null);
    await expect(run()).rejects.toMatchObject({ name: "PicoStrandedError", cause: null });
    expect(mocks.openLiveSerialPort).not.toHaveBeenCalled();
  });

  it("keeps the WebUSB refusal as the cause when the open is denied", async () => {
    mocks.getPicobootDevices.mockResolvedValue([usb]);
    const denied = new DOMException("Access denied.", "SecurityError");
    mocks.open.mockRejectedValue(denied);
    await expect(run()).rejects.toMatchObject({
      name: "PicoStrandedError",
      cause: denied,
    });
  });

  it("reports the Pico stranded when the reboot fails, still releasing the device", async () => {
    mocks.getPicobootDevices.mockResolvedValue([usb]);
    mocks.reboot.mockRejectedValue(new Error("stall"));
    await expect(run()).rejects.toBeInstanceOf(PicoStrandedError);
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("rethrows a failed touch as is (the Pico never left the firmware)", async () => {
    const err = new DOMException("gone", "NetworkError");
    mocks.resetToBootloader.mockRejectedValue(err);
    await expect(run()).rejects.toBe(err);
    expect(mocks.getPicobootDevices).not.toHaveBeenCalled();
  });

  it("returns null when the CDC port never comes back", async () => {
    mocks.getPicobootDevices.mockResolvedValue([usb]);
    mocks.openLiveSerialPort.mockResolvedValue(null);
    await expect(run()).resolves.toBeNull();
  });
});
