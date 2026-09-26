import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isOwnSerialReenumeration,
  markSerialActivity,
  portOfSerialConnectEvent,
  SERIAL_ACTIVITY_WINDOW_MS,
  SerialConnectAnnouncements,
  serialDeviceKey,
} from "../../src/util/serial-reacquire.js";

let nextProductId = 1;
const port = (usbProductId = nextProductId++) =>
  ({ getInfo: () => ({ usbVendorId: 0x2e8a, usbProductId }) }) as unknown as SerialPort;

afterEach(() => {
  vi.useRealTimers();
});

describe("portOfSerialConnectEvent", () => {
  it("takes the port from the event target, or the legacy port property", () => {
    const p = port();
    expect(portOfSerialConnectEvent({ target: p } as unknown as Event)).toBe(p);
    expect(portOfSerialConnectEvent({ port: p, target: null } as unknown as Event)).toBe(
      p
    );
    expect(portOfSerialConnectEvent({ target: {} } as unknown as Event)).toBeNull();
    // A legacy property holding something else must not hide the target.
    expect(portOfSerialConnectEvent({ port: "x", target: p } as unknown as Event)).toBe(
      p
    );
  });
});

describe("isOwnSerialReenumeration", () => {
  it("is true inside the activity window and extends it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    expect(isOwnSerialReenumeration()).toBe(false);
    markSerialActivity();
    vi.setSystemTime(1_000_000 + SERIAL_ACTIVITY_WINDOW_MS - 1);
    expect(isOwnSerialReenumeration()).toBe(true);
    // The check itself moved the window's start to now.
    vi.setSystemTime(1_000_000 + 2 * SERIAL_ACTIVITY_WINDOW_MS - 2);
    expect(isOwnSerialReenumeration()).toBe(true);
    vi.setSystemTime(1_000_000 + 4 * SERIAL_ACTIVITY_WINDOW_MS);
    expect(isOwnSerialReenumeration()).toBe(false);
  });
});

describe("serialDeviceKey", () => {
  it("keys a port by its USB ids, and gives an id-less port none", () => {
    expect(serialDeviceKey(port(0xf00a))).toBe(`${0x2e8a}:${0xf00a}`);
    expect(serialDeviceKey({ getInfo: () => ({}) } as unknown as SerialPort)).toBeNull();
    expect(
      serialDeviceKey({ getInfo: () => ({ usbVendorId: 1 }) } as unknown as SerialPort)
    ).toBeNull();
  });
});

describe("SerialConnectAnnouncements", () => {
  it("announces a device once per window, per device", () => {
    const seen = new SerialConnectAnnouncements(1000);
    const a = port();
    const b = port();
    expect(seen.shouldAnnounce(a, 0)).toBe(true);
    expect(seen.shouldAnnounce(a, 500)).toBe(false);
    expect(seen.shouldAnnounce(b, 500)).toBe(true);
    expect(seen.shouldAnnounce(a, 1000)).toBe(true);
  });

  it("recognises the fresh port object Chrome hands out after a re-enumeration", () => {
    const seen = new SerialConnectAnnouncements(1000);
    expect(seen.shouldAnnounce(port(0xf00a), 0)).toBe(true);
    // A reboot-looping board comes back as a new object with the same ids.
    expect(seen.shouldAnnounce(port(0xf00a), 500)).toBe(false);
  });

  it("announces a port without USB ids every time", () => {
    const seen = new SerialConnectAnnouncements(1000);
    const rfcomm = { getInfo: () => ({}) } as unknown as SerialPort;
    expect(seen.shouldAnnounce(rfcomm, 0)).toBe(true);
    expect(seen.shouldAnnounce(rfcomm, 1)).toBe(true);
  });
});
