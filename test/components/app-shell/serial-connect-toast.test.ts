// @vitest-environment happy-dom
/**
 * Pins the dashboard's "USB device connected" toast against a hub
 * re-enumeration (#1850): a connect that follows the same port's own
 * disconnect within the blip is not a plug-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { notifyInfo, isOwnSerialReenumeration } = vi.hoisted(() => ({
  notifyInfo: vi.fn(),
  isOwnSerialReenumeration: vi.fn(() => false),
}));
vi.mock("sonner-js", () => ({ default: { dismiss: vi.fn() } }));
vi.mock("../../../src/util/notify.js", () => ({
  LONG_TOAST_DURATION_MS: 8000,
  notifyInfo,
}));
vi.mock("../../../src/util/serial-reacquire.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isOwnSerialReenumeration,
}));

import { withWebSerial } from "../../_web-serial.js";
import { ESPHomeApp } from "../../../src/components/app-shell.js";

type Handlers = {
  _onSerialConnect: (e: Event) => void;
  _onSerialDisconnect: (e: Event) => void;
  _localize: (key: string) => string;
};

const port = { getInfo: () => ({}) } as SerialPort;
let restoreSerial: () => void;

beforeEach(() => {
  restoreSerial = withWebSerial(true, {
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

afterEach(() => {
  restoreSerial();
  vi.clearAllMocks();
  vi.useRealTimers();
  isOwnSerialReenumeration.mockReturnValue(false);
});

// The shell is never mounted: its connect lifecycle opens the WebSocket.
// The handlers are instance fields, so a bare instance carries them.
function makeShell(): Handlers {
  const shell = new ESPHomeApp() as unknown as Handlers;
  shell._localize = (key) => key;
  return shell;
}

describe("app-shell USB device connected toast", () => {
  it("announces a plugged-in device", () => {
    const shell = makeShell();
    shell._onSerialConnect({ target: port } as unknown as Event);
    expect(notifyInfo).toHaveBeenCalledTimes(1);
    expect(notifyInfo.mock.lastCall![0]).toBe("layout.usb_device_connected");
  });

  it("stays quiet for a board a hub re-enumerated, and still announces a hand replug", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const shell = makeShell();
    shell._onSerialDisconnect({ target: port } as unknown as Event);
    vi.setSystemTime(1_000_500);
    shell._onSerialConnect({ target: port } as unknown as Event);
    expect(notifyInfo).not.toHaveBeenCalled();
    shell._onSerialDisconnect({ target: port } as unknown as Event);
    vi.setSystemTime(1_005_000);
    shell._onSerialConnect({ target: port } as unknown as Event);
    expect(notifyInfo).toHaveBeenCalledTimes(1);
  });

  it("stays quiet for our own reset re-enumerating the device", () => {
    const shell = makeShell();
    isOwnSerialReenumeration.mockReturnValue(true);
    shell._onSerialConnect({ target: port } as unknown as Event);
    expect(notifyInfo).not.toHaveBeenCalled();
  });
});
