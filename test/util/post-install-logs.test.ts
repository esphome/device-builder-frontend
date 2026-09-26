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
  dialogLineHooks: () => ({ onLine: vi.fn() }),
  streamSerialToDialog: () => () => {},
}));

const { toastError, toastInfo } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastInfo: vi.fn(),
}));
vi.mock("sonner-js", () => ({ default: { error: toastError, info: toastInfo } }));
const picoReset = vi.hoisted(() => ({
  resetPicoForLogs:
    vi.fn<(port: SerialPort, baud: number) => Promise<SerialPort | null>>(),
  webUsb: true,
}));
vi.mock("../../src/platforms/rp2/rp2-logs-reset.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/platforms/rp2/rp2-logs-reset.js")>()),
  resetPicoForLogs: picoReset.resetPicoForLogs,
}));
const bleStream = vi.hoisted(() => ({
  streamBleNus:
    vi.fn<
      (
        device: BluetoothDevice,
        hooks: { onLine: (l: string) => void; onDisconnect?: () => void },
        opts: { attempts: number; cancelled: () => boolean }
      ) => Promise<() => Promise<void>>
    >(),
}));
vi.mock("../../src/platforms/nrf52/ble-nus-stream.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../src/platforms/nrf52/ble-nus-stream.js")
  >()),
  streamBleNus: bleStream.streamBleNus,
}));
vi.mock("../../src/platforms/rp2/web-usb.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/platforms/rp2/web-usb.js")>()),
  isWebUsbSupported: () => picoReset.webUsb,
}));

import { defaultLocalize } from "../../src/common/localize.js";
import { BleNusServiceNotFoundError } from "../../src/platforms/nrf52/ble-nus-stream.js";
import { PicoStrandedError } from "../../src/platforms/rp2/rp2-logs-reset.js";
import {
  attachBleNusLogs,
  attachSerialLogStream,
  formatSerialPortLabel,
  handlePostInstallShowLogs,
  picoResetHook,
  type PostInstallShowLogsDetail,
  reconnectWebSerialLogs,
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
  it("releases both lines after reopening an RTL8720C board's port", async () => {
    const port = openPort();
    const restore = withRequestPort(async () => port);
    const dialog = stubDialog();
    try {
      await reconnectWebSerialLogs(
        dialog as never,
        defaultLocalize,
        115200,
        null,
        () => false,
        "rtl87xx"
      );
      expect(port.setSignals).toHaveBeenCalledWith({
        dataTerminalReady: false,
        requestToSend: false,
      });
      expect(dialog.setSerialStream).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("acquires a fresh port via requestPort and streams it", async () => {
    const restore = withRequestPort(async () => openPort());
    const dialog = stubDialog();
    try {
      await reconnectWebSerialLogs(dialog as never, defaultLocalize, 115200, null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((navigator as any).serial.requestPort).toHaveBeenCalledTimes(1);
      expect(dialog.setSerialStream).toHaveBeenCalledTimes(1);
      expect(dialog.setSerialOpenFailed).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("leaves a newer session alone when the pick lands after the session moved on", async () => {
    const restore = withRequestPort(async () => openPort());
    const dialog = stubDialog();
    try {
      await reconnectWebSerialLogs(
        dialog as never,
        defaultLocalize,
        115200,
        null,
        () => true
      );
      expect(dialog.setSerialStream).not.toHaveBeenCalled();
      expect(dialog.abortSerialReconnect).not.toHaveBeenCalled();
      expect(dialog.switchToNetworkLogs).not.toHaveBeenCalled();
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
      await reconnectWebSerialLogs(dialog as never, defaultLocalize, 19200, null);
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
      await reconnectWebSerialLogs(dialog as never, defaultLocalize, 115200, null);
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
      await reconnectWebSerialLogs(dialog as never, defaultLocalize, 115200, null);
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
      await reconnectWebSerialLogs(dialog as never, defaultLocalize, 115200, null);
      expect(dialog.setSerialOpenFailed).toHaveBeenCalledTimes(1);
      expect(toastError).toHaveBeenCalledTimes(1);
      expect(dialog.abortSerialReconnect).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("picoResetHook", () => {
  // The port only reaches the mocked resetPicoForLogs, so any handle serves.
  const runHook = (
    dialog: ReturnType<typeof stubDialog>,
    cancelled: boolean,
    baud = 115200,
    port: SerialPort = openPort()
  ) =>
    picoResetHook(dialog as never, defaultLocalize, "rp2", baud)!.run(
      port,
      () => cancelled
    );

  it("is offered only for rp2 on a WebUSB browser", () => {
    const dialog = stubDialog() as never;
    expect(picoResetHook(dialog, defaultLocalize, "rp2", 115200)).toBeTypeOf("object");
    expect(picoResetHook(dialog, defaultLocalize, "esp32", 115200)).toBeUndefined();
    picoReset.webUsb = false;
    try {
      expect(picoResetHook(dialog, defaultLocalize, "rp2", 115200)).toBeUndefined();
    } finally {
      picoReset.webUsb = true;
    }
  });

  it("supports only the Pico's own CDC port, not a UART bridge", () => {
    const hook = picoResetHook(stubDialog() as never, defaultLocalize, "rp2", 115200)!;
    expect(hook.supports(openPort({ usbVendorId: 0x2e8a, usbProductId: 0xf00a }))).toBe(
      true
    );
    expect(hook.supports(openPort({ usbVendorId: 0x1a86, usbProductId: 0x7523 }))).toBe(
      false
    );
    // A Raspberry Pi Debug Probe is a bridge too, despite the vendor id.
    expect(hook.supports(openPort({ usbVendorId: 0x2e8a, usbProductId: 0x000c }))).toBe(
      false
    );
    expect(hook.supports(openPort({}))).toBe(false);
  });

  it("stays quiet when the dialog closed during the reset", async () => {
    const dialog = stubDialog();
    picoReset.resetPicoForLogs.mockResolvedValue(null);
    await runHook(dialog, true, 115200);
    expect(dialog.setSerialOpenFailed).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("only toasts a stranding once the dialog closed, leaving newer sessions alone", async () => {
    const dialog = stubDialog();
    picoReset.resetPicoForLogs.mockRejectedValue(new PicoStrandedError("pick"));
    await runHook(dialog, true, 115200);
    expect(dialog.setSerialOpenFailed).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      defaultLocalize("dashboard.logs_rp2_reset_stranded"),
      expect.anything()
    );
  });

  it("closes a port reopened for a session that is gone", async () => {
    const dialog = stubDialog();
    const live = openPort();
    picoReset.resetPicoForLogs.mockResolvedValue(live);
    await runHook(dialog, true, 115200);
    expect(live.close).toHaveBeenCalledOnce();
    expect(dialog.setSerialStream).not.toHaveBeenCalled();
  });

  it("streams the reopened port after the reboot", async () => {
    const dialog = stubDialog();
    const closed = deadPort();
    const live = openPort();
    picoReset.resetPicoForLogs.mockResolvedValue(live);
    await runHook(dialog, false, 9600, closed);
    expect(picoReset.resetPicoForLogs).toHaveBeenCalledWith(
      closed,
      9600,
      expect.any(Function)
    );
    expect(dialog.setSerialStream).toHaveBeenCalledWith(live, expect.any(Function));
    // The port came back open, so no DTR/RTS clear (a Pico needs DTR high).
    expect(live.setSignals).not.toHaveBeenCalled();
  });

  it("names the stranded Pico when the reboot could not be sent", async () => {
    const dialog = stubDialog();
    picoReset.resetPicoForLogs.mockRejectedValue(
      new PicoStrandedError("reboot", new Error("x"))
    );
    await runHook(dialog, false, 115200);
    const message = defaultLocalize("dashboard.logs_rp2_reset_stranded");
    expect(dialog.setSerialOpenFailed).toHaveBeenCalledWith(message);
    expect(toastError).toHaveBeenCalledWith(message, expect.anything());
  });

  it("names the udev rule when WebUSB refused the bootloader", async () => {
    const dialog = stubDialog();
    picoReset.resetPicoForLogs.mockRejectedValue(
      new PicoStrandedError(
        "refused",
        new DOMException("Access denied.", "SecurityError")
      )
    );
    await runHook(dialog, false, 115200);
    expect(dialog.setSerialOpenFailed).toHaveBeenCalledWith(
      defaultLocalize("firmware.rp2_usb_access_denied")
    );
  });

  it("reports a failed touch as a plain reset failure", async () => {
    const dialog = stubDialog();
    picoReset.resetPicoForLogs.mockRejectedValue(
      new DOMException("gone", "NetworkError")
    );
    await runHook(dialog, false, 115200);
    expect(dialog.setSerialOpenFailed).toHaveBeenCalledWith(
      defaultLocalize("dashboard.logs_reset_failed")
    );
  });

  it("reports a port that never came back, naming it", async () => {
    const dialog = stubDialog();
    picoReset.resetPicoForLogs.mockResolvedValue(null);
    await runHook(dialog, false, 115200);
    expect(dialog.setSerialOpenFailed).toHaveBeenCalledWith(
      defaultLocalize("dashboard.logs_port_reopen_failed", { port: "USB 303a:1001" })
    );
  });
});

describe("attachBleNusLogs", () => {
  const device = {} as BluetoothDevice;
  const bleDialog = () => ({ ...stubDialog(), setBleStream: vi.fn() });

  it("registers the stream once notifications flow", async () => {
    const dialog = bleDialog();
    const cancel = vi.fn(async () => {});
    bleStream.streamBleNus.mockResolvedValue(cancel);
    await attachBleNusLogs(dialog as never, defaultLocalize, device, () => false);
    expect(dialog.setBleStream).toHaveBeenCalledWith(cancel);
    expect(bleStream.streamBleNus).toHaveBeenCalledWith(
      device,
      expect.objectContaining({ onLine: expect.any(Function) }),
      expect.objectContaining({ attempts: 3 })
    );
  });

  it("cancels a stream that lands after the session moved on", async () => {
    const dialog = bleDialog();
    const cancel = vi.fn(async () => {});
    bleStream.streamBleNus.mockResolvedValue(cancel);
    await attachBleNusLogs(dialog as never, defaultLocalize, device, () => true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(dialog.setBleStream).not.toHaveBeenCalled();
  });

  it("names the wrong device when the NUS service is missing", async () => {
    const dialog = bleDialog();
    bleStream.streamBleNus.mockRejectedValue(new BleNusServiceNotFoundError());
    await attachBleNusLogs(dialog as never, defaultLocalize, device, () => false);
    const message = defaultLocalize("dashboard.logs_ble_nus_service_not_found");
    expect(dialog.setSerialOpenFailed).toHaveBeenCalledWith(message);
    expect(toastError).toHaveBeenCalledWith(message, expect.anything());
  });

  it("reports a failed connect", async () => {
    const dialog = bleDialog();
    bleStream.streamBleNus.mockRejectedValue(new DOMException("GATT", "NetworkError"));
    await attachBleNusLogs(dialog as never, defaultLocalize, device, () => false);
    expect(dialog.setSerialOpenFailed).toHaveBeenCalledWith(
      defaultLocalize("dashboard.logs_ble_nus_open_failed")
    );
  });

  it("ends the session quietly on a remote disconnect, leaving Start to reconnect", async () => {
    const dialog = bleDialog();
    bleStream.streamBleNus.mockImplementation(async (_d, hooks) => {
      hooks.onDisconnect?.();
      return async () => {};
    });
    await attachBleNusLogs(dialog as never, defaultLocalize, device, () => false);
    expect(dialog.setSerialOpenFailed).toHaveBeenCalledWith(
      defaultLocalize("dashboard.logs_ble_nus_disconnected")
    );
    expect(toastError).not.toHaveBeenCalled();
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

  it.each([
    ["rp2", "object"],
    ["esp32", "undefined"],
  ])("wires Reset Device for %s the way a card launch does", async (platform, kind) => {
    const dialog = logsDialog();
    const event = new CustomEvent("request-show-logs-after-install", {
      cancelable: true,
      detail: { ...detail(115200), targetPlatform: platform },
    });
    await handlePostInstallShowLogs(event, dialog as never, defaultLocalize);
    expect(dialog.openPassive).toHaveBeenCalledWith(
      expect.objectContaining({
        onResetDevice: expect.toSatisfy((h) => typeof h === kind),
      })
    );
  });
});
