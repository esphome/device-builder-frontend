import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resetToBootloader: vi.fn<(port: SerialPort) => Promise<void>>(),
  getPicobootDevices: vi.fn<() => Promise<USBDevice[]>>(),
  requestPicobootDevice: vi.fn<() => Promise<USBDevice | null>>(),
  open: vi.fn<(usb: USBDevice) => Promise<unknown>>(),
  reboot: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => Promise<void>>(),
  loadPicoboot: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("../../../src/util/serial-bootloader-touch.js", () => ({
  resetToBootloader: mocks.resetToBootloader,
}));
vi.mock("../../../src/platforms/rp2/web-usb.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/platforms/rp2/web-usb.js")>()),
  getPicobootDevices: mocks.getPicobootDevices,
  loadPicoboot: mocks.loadPicoboot,
  requestPicobootDevice: mocks.requestPicobootDevice,
}));

import {
  PicoStrandedError,
  rebootPico,
} from "../../../src/platforms/rp2/rp2-logs-reset.js";

const port = { getInfo: () => ({}) } as unknown as SerialPort;
const usb = { vendorId: 0x2e8a, productId: 3 } as USBDevice;
// A CDC handle the browser still sees as attached.
const stillThere = { getInfo: () => ({}), connected: true } as unknown as SerialPort;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.resetToBootloader.mockResolvedValue(undefined);
  mocks.getPicobootDevices.mockResolvedValue([]);
  mocks.requestPicobootDevice.mockResolvedValue(usb);
  mocks.open.mockResolvedValue({ reboot: mocks.reboot, close: mocks.close });
  mocks.loadPicoboot.mockResolvedValue({ PicobootDevice: { open: mocks.open } });
  mocks.reboot.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function run({
  cancelled = () => false,
  from = port,
}: { cancelled?: () => boolean; from?: SerialPort } = {}): Promise<boolean> {
  const result = rebootPico(from, cancelled);
  // Silence the rejection until the test inspects it; the poll below needs
  // the timers advanced either way.
  result.catch(() => {});
  await vi.runAllTimersAsync();
  return result;
}

// The bootloader shows up as granted only after the pre-touch snapshot.
const grantedAfterTouch = () =>
  mocks.getPicobootDevices.mockResolvedValueOnce([]).mockResolvedValue([usb]);

describe("rebootPico", () => {
  it("touches and reboots a granted bootloader without the chooser", async () => {
    grantedAfterTouch();
    await expect(run()).resolves.toBe(true);
    expect(mocks.resetToBootloader).toHaveBeenCalledWith(port);
    expect(mocks.requestPicobootDevice).not.toHaveBeenCalled();
    expect(mocks.open).toHaveBeenCalledWith(usb);
    expect(mocks.reboot).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("ignores a bootloader that was already present before the touch", async () => {
    const other = { vendorId: 0x2e8a, productId: 3 } as USBDevice;
    mocks.getPicobootDevices.mockResolvedValue([other]);
    await expect(run()).resolves.toBe(true);
    expect(mocks.requestPicobootDevice).toHaveBeenCalledOnce();
    expect(mocks.open).toHaveBeenCalledWith(usb);
  });

  it("reports a plain failure when the CDC port never left (touch ignored)", async () => {
    mocks.requestPicobootDevice.mockResolvedValue(null);
    await expect(run({ from: stillThere })).rejects.not.toBeInstanceOf(PicoStrandedError);
  });

  it("reads a chooser rejection with the CDC still connected as an ignored touch too", async () => {
    mocks.requestPicobootDevice.mockRejectedValue(new Error("lapsed"));
    await expect(run({ from: stillThere })).rejects.toThrow(/ignored/);
  });

  it("keeps the stranded hint on an early cancel, when the CDC may still be dropping", async () => {
    let calls = 0;
    const cancelled = () => calls++ > 0;
    await expect(run({ from: stillThere, cancelled })).rejects.toMatchObject({
      step: "pick",
    });
  });

  it("reboots a chooser-picked RP2350 too (the engine picks REBOOT2 for it)", async () => {
    const rp2350 = { vendorId: 0x2e8a, productId: 0xf } as USBDevice;
    mocks.requestPicobootDevice.mockResolvedValue(rp2350);
    await expect(run()).resolves.toBe(true);
    expect(mocks.open).toHaveBeenCalledWith(rp2350);
  });

  it("returns without touching when cancelled before the touch", async () => {
    await expect(run({ cancelled: () => true })).resolves.toBe(false);
    expect(mocks.resetToBootloader).not.toHaveBeenCalled();
  });

  it("tells a granted board apart by serial number and ids, not by wrapper identity", async () => {
    const first = { vendorId: 0x2e8a, productId: 3, serialNumber: "E66" } as USBDevice;
    const again = { vendorId: 0x2e8a, productId: 3, serialNumber: "E66" } as USBDevice;
    mocks.getPicobootDevices.mockResolvedValueOnce([first]).mockResolvedValue([again]);
    await expect(run()).resolves.toBe(true);
    expect(mocks.requestPicobootDevice).toHaveBeenCalledOnce(); // `again` is not new
    expect(mocks.open).toHaveBeenCalledWith(usb);
  });

  it("stops before the chooser once cancelled during the poll", async () => {
    let calls = 0;
    // Cancelled from the first poll round on, after the touch went out.
    const cancelled = () => calls++ > 0;
    await expect(run({ cancelled })).rejects.toMatchObject({ step: "pick" });
    expect(mocks.resetToBootloader).toHaveBeenCalledOnce();
    expect(mocks.requestPicobootDevice).not.toHaveBeenCalled();
    expect(mocks.reboot).not.toHaveBeenCalled();
  });

  it("falls back to the chooser when no granted bootloader appears in time", async () => {
    await expect(run()).resolves.toBe(true);
    expect(mocks.getPicobootDevices.mock.calls.length).toBeGreaterThan(1);
    expect(mocks.requestPicobootDevice).toHaveBeenCalledOnce();
    expect(mocks.reboot).toHaveBeenCalledOnce();
  });

  it("reports the Pico stranded when the chooser is dismissed", async () => {
    mocks.requestPicobootDevice.mockResolvedValue(null);
    await expect(run()).rejects.toMatchObject({
      name: "PicoStrandedError",
      step: "pick",
    });
  });

  it("treats a chooser SecurityError as a lapsed pick, not a refused device", async () => {
    mocks.requestPicobootDevice.mockRejectedValue(
      new DOMException("Must be handling a user gesture", "SecurityError")
    );
    await expect(run()).rejects.toMatchObject({ step: "pick" });
  });

  it("reports the Pico stranded when the engine chunk fails to load after the touch", async () => {
    grantedAfterTouch();
    mocks.loadPicoboot.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(run()).rejects.toMatchObject({
      name: "PicoStrandedError",
      step: "reboot",
    });
  });

  it("keeps the WebUSB refusal as the cause when the open is denied", async () => {
    grantedAfterTouch();
    const denied = new DOMException("Access denied.", "SecurityError");
    mocks.open.mockRejectedValue(denied);
    await expect(run()).rejects.toMatchObject({
      name: "PicoStrandedError",
      step: "refused",
      cause: denied,
    });
  });

  it("reports the Pico stranded when the reboot fails, still releasing the device", async () => {
    grantedAfterTouch();
    mocks.reboot.mockRejectedValue(new Error("stall"));
    await expect(run()).rejects.toMatchObject({
      name: "PicoStrandedError",
      step: "reboot",
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("rethrows a failed touch as is (the Pico never left the firmware)", async () => {
    const err = new DOMException("gone", "NetworkError");
    mocks.resetToBootloader.mockRejectedValue(err);
    await expect(run()).rejects.toBe(err);
    expect(mocks.getPicobootDevices).toHaveBeenCalledOnce(); // the pre-touch snapshot only
    expect(mocks.requestPicobootDevice).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
