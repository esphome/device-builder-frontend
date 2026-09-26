// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { isOwnSerialReenumeration } = vi.hoisted(() => ({
  isOwnSerialReenumeration: vi.fn(() => false),
}));
vi.mock("../../src/util/serial-reacquire.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isOwnSerialReenumeration,
}));

import { withWebSerial } from "../_web-serial.js";
import {
  SERIAL_REENUMERATION_BLIP_MS,
  watchSerialPlugIns,
} from "../../src/util/serial-plug-ins.js";

// Distinct devices get distinct ids; Chrome keys a port by its device, and
// hands out a fresh object for the same device after a re-enumeration.
let nextProductId = 1;
const port = (usbProductId = nextProductId++) =>
  ({ getInfo: () => ({ usbVendorId: 0x2e8a, usbProductId }) }) as unknown as SerialPort;

let serialListeners: Record<string, (e: Event) => void>;
let restoreSerial: () => void;

beforeEach(() => {
  serialListeners = {};
  restoreSerial = withWebSerial(true, {
    addEventListener: (type: string, fn: (e: Event) => void) => {
      serialListeners[type] = fn;
    },
    removeEventListener: (type: string) => {
      delete serialListeners[type];
    },
  });
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  restoreSerial();
  vi.useRealTimers();
  vi.clearAllMocks();
  isOwnSerialReenumeration.mockReturnValue(false);
});

// Current Chromium fires connect and disconnect at the port itself (event.target).
const plugIn = (p: SerialPort) =>
  serialListeners.connect({ target: p } as unknown as Event);
const unplug = (p: SerialPort) =>
  serialListeners.disconnect({ target: p } as unknown as Event);

describe("watchSerialPlugIns", () => {
  it("reports a plug-in of a permitted port, and stops when unwatched", () => {
    const onPlugIn = vi.fn();
    const unwatch = watchSerialPlugIns(onPlugIn);
    const p = port();
    plugIn(p);
    expect(onPlugIn).toHaveBeenCalledWith(p);
    expect(Object.keys(serialListeners).sort()).toEqual(["connect", "disconnect"]);
    unwatch();
    expect(serialListeners).toEqual({});
  });

  it("drops a connect that follows the device's own disconnect within the blip", () => {
    const onPlugIn = vi.fn();
    watchSerialPlugIns(onPlugIn);
    const hubbed = port(0xf00a);
    const neighbour = port(0xf00b);
    // Plugging something else into the hub bounced it: disconnect, then a
    // connect about half a second later, on a fresh object for the same
    // device (Chrome). The device it did not touch is a plug-in as before.
    unplug(hubbed);
    vi.advanceTimersByTime(SERIAL_REENUMERATION_BLIP_MS / 2);
    plugIn(port(0xf00a));
    plugIn(neighbour);
    expect(onPlugIn).toHaveBeenCalledTimes(1);
    expect(onPlugIn).toHaveBeenCalledWith(neighbour);
  });

  it("treats a connect past the blip as a plug-in", () => {
    const onPlugIn = vi.fn();
    watchSerialPlugIns(onPlugIn);
    const replugged = port();
    unplug(replugged);
    vi.advanceTimersByTime(SERIAL_REENUMERATION_BLIP_MS);
    plugIn(replugged);
    expect(onPlugIn).toHaveBeenCalledWith(replugged);
  });

  it("only the first connect after a disconnect is the blip", () => {
    const onPlugIn = vi.fn();
    watchSerialPlugIns(onPlugIn);
    const p = port();
    unplug(p);
    plugIn(p);
    plugIn(p);
    expect(onPlugIn).toHaveBeenCalledTimes(1);
  });

  it("drops our own reset re-enumerating the device", () => {
    const onPlugIn = vi.fn();
    watchSerialPlugIns(onPlugIn);
    isOwnSerialReenumeration.mockReturnValue(true);
    plugIn(port());
    expect(onPlugIn).not.toHaveBeenCalled();
  });

  it("ignores an event that carries no port", () => {
    const onPlugIn = vi.fn();
    watchSerialPlugIns(onPlugIn);
    serialListeners.connect({ target: {} } as unknown as Event);
    expect(onPlugIn).not.toHaveBeenCalled();
  });
});
