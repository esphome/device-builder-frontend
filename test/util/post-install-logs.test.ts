/**
 * @vitest-environment happy-dom
 *
 * The post-install Web Serial logs handoff. After a native-USB chip's
 * post-flash re-enumeration the cached esptool handle is dead, so the auto
 * reopen prefers a fresh navigator.serial.getPorts() handle (no picker); only
 * the user-gesture "Start" reconnect re-prompts via requestPort(). The
 * reopen-failure message names the port being tried.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/dashboard/actions.js", () => ({
  streamSerialToDialog: () => () => {},
}));

const { toastError, toastInfo } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));
vi.mock("sonner-js", () => ({ default: { error: toastError, info: toastInfo } }));

import { defaultLocalize } from "../../src/common/localize.js";
import {
  attachSerialLogStream,
  formatSerialPortLabel,
  handlePostInstallShowLogs,
  reconnectWebSerialLogs,
  type PostInstallShowLogsDetail,
} from "../../src/util/post-install-logs.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
function openPort(
  info: SerialPortInfo = { usbVendorId: 0x303a, usbProductId: 0x1001 }
): SerialPort {
  return {
    readable: {} as ReadableStream,
    getInfo: () => info,
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    setSignals: vi.fn().mockResolvedValue(undefined),
  } as unknown as SerialPort;
}

// A closed port whose open() always rejects. Defaults to a non-NetworkError;
// the reopen falls through to the next candidate either way, so pass a
// NetworkError only when a test cares about the error kind.
function deadPort(
  error: unknown = new DOMException("blocked", "SecurityError")
): SerialPort {
  return {
    readable: null,
    getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
    open: vi.fn().mockRejectedValue(error),
    setSignals: vi.fn(),
  } as unknown as SerialPort;
}

function stubDialog() {
  return {
    open: vi.fn(),
    switchToNetworkLogs: vi.fn(),
    setSerialStream: vi.fn(),
    setSerialOpenFailed: vi.fn(),
    abortSerialReconnect: vi.fn(),
  };
}

// Restore the original `navigator.serial`, deleting the injected property when
// it didn't exist before (happy-dom has none) so a leaked `"serial" in
// navigator` can't make later tests order-dependent.
function restoreSerial(had: boolean, prev: unknown): () => void {
  return () => {
    if (had) {
      Object.defineProperty(navigator, "serial", { configurable: true, value: prev });
    } else {
      delete (navigator as any).serial;
    }
  };
}

function withRequestPort(impl: () => Promise<SerialPort>): () => void {
  const restore = restoreSerial("serial" in navigator, (navigator as any).serial);
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: { requestPort: vi.fn(impl) },
  });
  return restore;
}

function withGetPorts(impl: () => Promise<SerialPort[]>): () => void {
  const restore = restoreSerial("serial" in navigator, (navigator as any).serial);
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: { getPorts: vi.fn(impl) },
  });
  return restore;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

afterEach(() => {
  vi.clearAllMocks();
});

describe("formatSerialPortLabel", () => {
  it("formats USB vendor:product as 4-digit hex", () => {
    expect(formatSerialPortLabel(openPort())).toBe("USB 303a:1001");
  });

  it("falls back to a neutral label when USB ids are absent", () => {
    expect(formatSerialPortLabel(openPort({}))).toBe("unknown device");
  });
});

describe("reconnectWebSerialLogs", () => {
  it("acquires a fresh port via requestPort and streams it", async () => {
    const restore = withRequestPort(async () => openPort());
    const dialog = stubDialog();
    try {
      await reconnectWebSerialLogs(dialog as never, defaultLocalize, 115200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((navigator as any).serial.requestPort).toHaveBeenCalledTimes(1);
      expect(dialog.setSerialStream).toHaveBeenCalledTimes(1);
      expect(dialog.setSerialOpenFailed).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("opens the picked port at the resolved baud", async () => {
    const port = openPort();
    const restore = withRequestPort(async () => port);
    const dialog = stubDialog();
    try {
      await reconnectWebSerialLogs(dialog as never, defaultLocalize, 19200);
      expect(port.open).toHaveBeenCalledWith({ baudRate: 19200 });
    } finally {
      restore();
    }
  });

  it("returns to dead without an error when the picker is dismissed", async () => {
    // A dismissed picker rejects with DOMException NotFoundError.
    const restore = withRequestPort(async () => {
      throw new DOMException("dismissed", "NotFoundError");
    });
    const dialog = stubDialog();
    try {
      await reconnectWebSerialLogs(dialog as never, defaultLocalize, 115200);
      expect(dialog.abortSerialReconnect).toHaveBeenCalledTimes(1);
      expect(dialog.setSerialOpenFailed).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("reroutes a reconnect onto a mismatched port without opening it", async () => {
    // Re-picked a bridge port for a native-USB console: same pre-open gate
    // as the entry points, so no DTR/RTS pulse and no dead serial session.
    const bridge = {
      readable: null,
      getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
      open: vi.fn(),
    } as unknown as SerialPort;
    const restore = withRequestPort(async () => bridge);
    const dialog = stubDialog();
    try {
      await reconnectWebSerialLogs(
        dialog as never,
        defaultLocalize,
        115200,
        "USB_SERIAL_JTAG"
      );
      expect(bridge.open).not.toHaveBeenCalled();
      // Mid-session swap, not a fresh open: buffer + back-to-install survive;
      // the reason rides into the pane so it outlives the toast.
      expect(dialog.switchToNetworkLogs).toHaveBeenCalledWith(
        expect.stringContaining("logger outputs on USB_SERIAL_JTAG")
      );
      expect(dialog.open).not.toHaveBeenCalled();
      expect(toastInfo).toHaveBeenCalledTimes(1);
      expect(dialog.setSerialStream).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("surfaces a non-cancel requestPort failure instead of swallowing it", async () => {
    const restore = withRequestPort(async () => {
      throw new DOMException("blocked", "SecurityError");
    });
    const dialog = stubDialog();
    try {
      await reconnectWebSerialLogs(dialog as never, defaultLocalize, 115200);
      expect(dialog.setSerialOpenFailed).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(dialog.abortSerialReconnect).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("surfaces an open failure when the picked port won't open", async () => {
    const port = openPort();
    (port.open as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("claimed"));
    const restore = withRequestPort(async () => port);
    const dialog = stubDialog();
    try {
      await reconnectWebSerialLogs(dialog as never, defaultLocalize, 115200);
      expect(dialog.setSerialOpenFailed).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(dialog.abortSerialReconnect).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("attachSerialLogStream reopen", () => {
  it("opens a fresh getPorts() handle when the cached one is dead (Chrome re-enum)", async () => {
    // The cached esptool handle won't reopen, but getPorts() yields a live one
    // for the same device — the auto path must recover with no picker.
    const live = openPort();
    const restore = withGetPorts(async () => [live]);
    const dialog = stubDialog();
    try {
      await attachSerialLogStream(deadPort(), dialog as never, defaultLocalize, 115200);
      expect(dialog.setSerialStream).toHaveBeenCalledTimes(1);
      expect(dialog.setSerialStream.mock.calls[0][0]).toBe(live); // streamed the live handle
      expect(dialog.setSerialOpenFailed).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("reopens the live handle at the resolved baud", async () => {
    // A closed live handle from getPorts() must be reopened at the device's
    // configured log baud, not the flash baud.
    const live = {
      readable: null,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
      open: vi.fn().mockResolvedValue(undefined),
      setSignals: vi.fn().mockResolvedValue(undefined),
    } as unknown as SerialPort;
    const restore = withGetPorts(async () => [live]);
    const dialog = stubDialog();
    try {
      await attachSerialLogStream(deadPort(), dialog as never, defaultLocalize, 19200);
      expect(live.open).toHaveBeenCalledWith({ baudRate: 19200 });
      expect(dialog.setSerialStream).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("falls through a non-NetworkError fresh handle to the cached port", async () => {
    // A re-enumerated handle that fails non-NetworkError (e.g. SecurityError on
    // a phantom UART bridge) must not abandon the cached fallback the loop
    // exists to provide. Resolves on the first round, so no fake timers.
    const cached = {
      readable: null,
      getInfo: () => ({ usbVendorId: 0x303a, usbProductId: 0x1001 }),
      open: vi.fn().mockResolvedValue(undefined),
      setSignals: vi.fn().mockResolvedValue(undefined),
    } as unknown as SerialPort;
    const restore = withGetPorts(async () => [
      deadPort(new DOMException("blocked", "SecurityError")),
    ]);
    const dialog = stubDialog();
    try {
      await attachSerialLogStream(cached, dialog as never, defaultLocalize, 115200);
      expect(cached.open).toHaveBeenCalledWith({ baudRate: 115200 });
      expect(dialog.setSerialStream).toHaveBeenCalledTimes(1);
      expect(dialog.setSerialStream.mock.calls[0][0]).toBe(cached);
      expect(dialog.setSerialOpenFailed).not.toHaveBeenCalled();
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("retries NetworkError across the window, then names the port and logs a breadcrumb", async () => {
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const restore = withGetPorts(async () => []); // device never reappears
    const dialog = stubDialog();
    try {
      const port = deadPort(new DOMException("gone", "NetworkError"));
      const done = attachSerialLogStream(port, dialog as never, defaultLocalize, 115200);
      await vi.advanceTimersByTimeAsync(8100);
      await done;
      expect(dialog.setSerialOpenFailed).toHaveBeenCalledTimes(1);
      expect(dialog.setSerialOpenFailed.mock.calls[0][0] as string).toContain(
        "USB 303a:1001"
      );
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(errSpy).toHaveBeenCalled(); // last open error logged for field debugging
    } finally {
      errSpy.mockRestore();
      restore();
      vi.useRealTimers();
    }
  });
});

describe("handlePostInstallShowLogs serial baud", () => {
  function detail(loggerBaudRate: number | null): PostInstallShowLogsDetail {
    return {
      configuration: "x.yaml",
      name: "X",
      webSerialPort: openPort(),
      loggerBaudRate,
      reopenInstall: vi.fn(),
    };
  }

  function logsDialog() {
    return {
      configuration: "",
      name: "",
      open: vi.fn(),
      openPassive: vi.fn(),
      setSerialStream: vi.fn(),
      setSerialOpenFailed: vi.fn(),
      abortSerialReconnect: vi.fn(),
    };
  }

  it("reroutes to network logs when logging is disabled (baud 0)", async () => {
    const dialog = logsDialog();
    const event = new CustomEvent("request-show-logs-after-install", {
      cancelable: true,
      detail: detail(0),
    });
    await handlePostInstallShowLogs(event, dialog as never, defaultLocalize);
    expect(dialog.open).toHaveBeenCalledWith("OTA", {
      onBackToInstall: event.detail.reopenInstall,
    });
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
    expect(dialog.openPassive).not.toHaveBeenCalled();
    expect(dialog.setSerialStream).not.toHaveBeenCalled();
  });

  it("reroutes to network logs when the port can't carry the console", async () => {
    // A CH340-class bridge on a device whose logger outputs on native USB —
    // the #1430 heat-pump shape.
    const dialog = logsDialog();
    const event = new CustomEvent("request-show-logs-after-install", {
      cancelable: true,
      detail: {
        ...detail(115200),
        webSerialPort: openPort({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
        loggerInterface: "USB_SERIAL_JTAG",
      },
    });
    await handlePostInstallShowLogs(event, dialog as never, defaultLocalize);
    expect(dialog.open).toHaveBeenCalledWith("OTA", {
      onBackToInstall: event.detail.reopenInstall,
    });
    expect(toastInfo).toHaveBeenCalledTimes(1);
    expect(dialog.openPassive).not.toHaveBeenCalled();
  });

  it("keeps the serial session when the port matches the console", async () => {
    // Native Espressif port + native-USB console: the common healthy path.
    const dialog = logsDialog();
    const event = new CustomEvent("request-show-logs-after-install", {
      cancelable: true,
      detail: { ...detail(115200), loggerInterface: "USB_SERIAL_JTAG" },
    });
    await handlePostInstallShowLogs(event, dialog as never, defaultLocalize);
    expect(dialog.open).not.toHaveBeenCalled();
    expect(dialog.openPassive).toHaveBeenCalledTimes(1);
  });
});
