import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const launch = vi.hoisted(() => ({
  requestSerialPort: vi.fn<() => Promise<SerialPort | null>>(),
  attachSerialLogStream: vi.fn(async () => {}),
  picoResetHook: vi.fn<() => SerialResetHook | undefined>(),
}));
vi.mock("../../src/util/web-serial.js", () => ({
  requestSerialPort: launch.requestSerialPort,
}));
const ble = vi.hoisted(() => ({
  requestBleNusDevice: vi.fn<() => Promise<BluetoothDevice | null>>(),
  streamBleNus: vi.fn<() => Promise<() => Promise<void>>>(),
}));
vi.mock("../../src/util/ble-nus-stream.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/util/ble-nus-stream.js")>()),
  isWebBluetoothSupported: () => true,
  requestBleNusDevice: ble.requestBleNusDevice,
  streamBleNus: ble.streamBleNus,
}));
vi.mock("../../src/util/post-install-logs.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/util/post-install-logs.js")>()),
  attachSerialLogStream: launch.attachSerialLogStream,
  picoResetHook: launch.picoResetHook,
}));

import toast from "sonner-js";
import { withWebBluetooth, withWebSerial } from "../_web-serial.js";
import { CommandTimeoutError } from "../../src/api/index.js";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import type { SerialResetHook } from "../../src/components/logs-dialog/session.js";
import { BleUnavailableError } from "../../src/util/ble-nus-stream.js";
import type { LogsLaunchHost } from "../../src/util/logs-launch.js";
import { launchLogs, launchLogsWithMethod } from "../../src/util/logs-launch.js";

function makeDevice(): ConfiguredDevice {
  return {
    name: "kitchen",
    friendly_name: "Kitchen",
    configuration: "kitchen.yaml",
  } as ConfiguredDevice;
}

type TestHost = LogsLaunchHost & {
  logsDialog: {
    configuration?: string;
    name?: string;
    open: ReturnType<typeof vi.fn>;
    openPassive: ReturnType<typeof vi.fn>;
    setBleStream: ReturnType<typeof vi.fn>;
  };
};

function makeHost(getSerialPorts: () => Promise<unknown>): TestHost {
  return {
    api: { getSerialPorts: vi.fn(getSerialPorts) },
    logsDialog: { open: vi.fn(), openPassive: vi.fn(), setBleStream: vi.fn() },
    localize: (key: string) => key,
  } as unknown as TestHost;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("launchLogs", () => {
  it("opens the method picker when WebSerial is available, skipping the backend", async () => {
    const restore = withWebSerial(true);
    try {
      const host = makeHost(async () => []);
      const openPicker = vi.fn();
      await launchLogs(host, makeDevice(), openPicker);

      expect(openPicker).toHaveBeenCalledTimes(1);
      expect(host.logsDialog.open).not.toHaveBeenCalled();
      expect(host.api.getSerialPorts).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("opens the method picker when the server reports serial ports (no WebSerial)", async () => {
    const restore = withWebSerial(false);
    try {
      const host = makeHost(async () => [{ port: "/dev/ttyUSB0", desc: "USB serial" }]);
      const openPicker = vi.fn();
      await launchLogs(host, makeDevice(), openPicker);

      expect(host.api.getSerialPorts).toHaveBeenCalledTimes(1);
      expect(openPicker).toHaveBeenCalledTimes(1);
      expect(host.logsDialog.open).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("opens OTA logs directly when there is no serial path at all", async () => {
    const restore = withWebSerial(false);
    try {
      const host = makeHost(async () => []);
      const openPicker = vi.fn();
      await launchLogs(host, makeDevice(), openPicker);

      expect(openPicker).not.toHaveBeenCalled();
      expect(host.logsDialog.open).toHaveBeenCalledTimes(1);
      expect(host.logsDialog.configuration).toBe("kitchen.yaml");
      expect(host.logsDialog.name).toBe("Kitchen");
    } finally {
      restore();
    }
  });

  it("falls back to OTA logs when the serial-port lookup fails", async () => {
    const restore = withWebSerial(false);
    try {
      const host = makeHost(async () => {
        throw new Error("backend unavailable");
      });
      const openPicker = vi.fn();
      await launchLogs(host, makeDevice(), openPicker);

      expect(openPicker).not.toHaveBeenCalled();
      expect(host.logsDialog.open).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("bounds the serial-port probe so a hung lookup still opens OTA logs", async () => {
    const restore = withWebSerial(false);
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const host = makeHost(async () => {
        throw new CommandTimeoutError("config/serial_ports", 2500);
      });
      const openPicker = vi.fn();
      await launchLogs(host, makeDevice(), openPicker);

      // The probe passes the short bound down to the command layer, so the
      // wire timeout is what fires on a degraded link.
      expect(host.api.getSerialPorts).toHaveBeenCalledWith(2500);
      expect(openPicker).not.toHaveBeenCalled();
      expect(host.logsDialog.open).toHaveBeenCalledTimes(1);
      expect(host.logsDialog.configuration).toBe("kitchen.yaml");
      // A timeout isn't an answer: say the probe was skipped rather than
      // let the serial option silently vanish for a user who has one.
      expect(toast.info).toHaveBeenCalledWith(
        "dashboard.logs_serial_probe_failed",
        expect.anything()
      );
    } finally {
      restore();
    }
  });

  it("says the probe was skipped when the socket drops mid-probe", async () => {
    vi.mocked(toast.info).mockClear();
    const restore = withWebSerial(false);
    try {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const host = makeHost(async () => {
        throw new Error("WebSocket connection closed");
      });
      await launchLogs(host, makeDevice(), vi.fn());

      // A transport fault is no more an answer than a timeout.
      expect(host.logsDialog.open).toHaveBeenCalledTimes(1);
      expect(toast.info).toHaveBeenCalledWith(
        "dashboard.logs_serial_probe_failed",
        expect.anything()
      );
    } finally {
      restore();
    }
  });

  it("stays quiet when the server genuinely reports no serial ports", async () => {
    vi.mocked(toast.info).mockClear();
    const restore = withWebSerial(false);
    try {
      const host = makeHost(async () => []);
      await launchLogs(host, makeDevice(), vi.fn());
      expect(toast.info).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

describe("launchLogsWithMethod", () => {
  it("routes ota without a port to the OTA sentinel", async () => {
    const host = makeHost(async () => []);
    await launchLogsWithMethod(host, makeDevice(), "ota");
    expect(host.logsDialog.open).toHaveBeenCalledWith("OTA");
    expect(host.logsDialog.configuration).toBe("kitchen.yaml");
    expect(host.logsDialog.name).toBe("Kitchen");
  });

  it("routes ota with an address override to open(port)", async () => {
    const host = makeHost(async () => []);
    await launchLogsWithMethod(host, makeDevice(), "ota", "192.168.5.243");
    expect(host.logsDialog.open).toHaveBeenCalledWith("192.168.5.243");
  });

  it("routes server-serial to open(port)", async () => {
    const host = makeHost(async () => []);
    await launchLogsWithMethod(host, makeDevice(), "server-serial", "/dev/ttyUSB0");
    expect(host.logsDialog.open).toHaveBeenCalledWith("/dev/ttyUSB0");
  });

  it("ignores server-serial with no port instead of silently opening OTA logs", async () => {
    const host = makeHost(async () => []);
    await launchLogsWithMethod(host, makeDevice(), "server-serial");
    expect(host.logsDialog.open).not.toHaveBeenCalled();
  });
});

describe("launchLogsWithMethod web-serial", () => {
  // Chromium asserts DTR and RTS on open; an RTL8720C kit needs them released
  // (see releasesLinesAfterOpen), an ESP board must keep the open's state.
  it.each([
    ["rtl87xx", true],
    ["esp32", false],
  ])("releases the lines after opening a %s port: %s", async (platform, released) => {
    const restore = withWebSerial(true);
    const setSignals = vi.fn(async () => {});
    const port = {
      getInfo: () => ({}),
      open: vi.fn(async () => {}),
      setSignals,
    } as unknown as SerialPort;
    launch.requestSerialPort.mockResolvedValue(port);
    const host = makeHost(async () => []);
    try {
      await launchLogsWithMethod(
        host,
        { ...makeDevice(), target_platform: platform },
        "web-serial"
      );
      expect(port.open).toHaveBeenCalledWith({ baudRate: 115200 });
      if (released) {
        expect(setSignals).toHaveBeenCalledWith({
          dataTerminalReady: false,
          requestToSend: false,
        });
      } else {
        expect(setSignals).not.toHaveBeenCalled();
      }
      expect(launch.attachSerialLogStream).toHaveBeenCalledWith(
        port,
        host.logsDialog,
        host.localize,
        115200,
        undefined
      );
    } finally {
      restore();
    }
  });

  it("hands the Pico reset hook to the passive session", async () => {
    const restore = withWebSerial(true);
    const port = {
      getInfo: () => ({}),
      open: vi.fn(async () => {}),
    } as unknown as SerialPort;
    launch.requestSerialPort.mockResolvedValue(port);
    const hook = { supports: () => true, run: async () => {} };
    launch.picoResetHook.mockReturnValue(hook);
    const host = makeHost(async () => []);
    try {
      const device = { ...makeDevice(), target_platform: "rp2", logger_baud_rate: null };
      await launchLogsWithMethod(host, device, "web-serial");
      expect(launch.picoResetHook).toHaveBeenCalledWith(
        host.logsDialog,
        host.localize,
        "rp2",
        115200
      );
      expect(host.logsDialog.openPassive).toHaveBeenCalledWith(
        expect.objectContaining({ onResetDevice: hook })
      );
    } finally {
      restore();
    }
  });
});

describe("launchLogsWithMethod ble-nus", () => {
  it("opens a BLE passive session and registers the stream", async () => {
    const device = {} as BluetoothDevice;
    const cancel = vi.fn(async () => {});
    ble.requestBleNusDevice.mockResolvedValue(device);
    ble.streamBleNus.mockResolvedValue(cancel);
    const host = makeHost(async () => []);
    host.logsDialog.openPassive.mockReturnValue(() => false);
    await launchLogsWithMethod(host, makeDevice(), "ble-nus");
    expect(ble.requestBleNusDevice).toHaveBeenCalledWith(["kitchen", "Kitchen"]);
    expect(host.logsDialog.openPassive).toHaveBeenCalledWith(
      expect.objectContaining({ source: "ble", onReconnect: expect.any(Function) })
    );
    expect(ble.streamBleNus).toHaveBeenCalledWith(
      device,
      expect.objectContaining({ onLine: expect.any(Function) }),
      expect.objectContaining({ attempts: 3 })
    );
    expect(host.logsDialog.setBleStream).toHaveBeenCalledWith(cancel);
  });

  it("toasts instead of leaving an unhandled rejection when the BLE attach throws", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ble.requestBleNusDevice.mockResolvedValue({} as BluetoothDevice);
    ble.streamBleNus.mockRejectedValue(new Error("boom"));
    const host = makeHost(async () => []);
    host.logsDialog.openPassive.mockReturnValue(() => false);
    host.logsDialog.setBleStream.mockImplementation(() => {
      throw new Error("late");
    });
    await expect(
      launchLogsWithMethod(host, makeDevice(), "ble-nus")
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("says Bluetooth is off or blocked when the adapter is unavailable", async () => {
    ble.requestBleNusDevice.mockRejectedValue(new BleUnavailableError());
    const host = makeHost(async () => []);
    await launchLogsWithMethod(host, makeDevice(), "ble-nus");
    expect(toast.error).toHaveBeenCalledWith(
      "dashboard.logs_ble_nus_unavailable",
      expect.anything()
    );
    expect(host.logsDialog.openPassive).not.toHaveBeenCalled();
  });

  it("does nothing when the chooser is dismissed", async () => {
    ble.requestBleNusDevice.mockResolvedValue(null);
    const host = makeHost(async () => []);
    await launchLogsWithMethod(host, makeDevice(), "ble-nus");
    expect(host.logsDialog.openPassive).not.toHaveBeenCalled();
  });
});

describe("launchLogs with Bluetooth", () => {
  it("opens the method picker for an nRF52 on Bluetooth alone, with no serial path", async () => {
    const restoreSerial = withWebSerial(false);
    const restoreBluetooth = withWebBluetooth({});
    const host = makeHost(async () => []); // no server serial ports either
    const openMethodPicker = vi.fn();
    try {
      await launchLogs(
        host,
        { ...makeDevice(), target_platform: "nrf52" },
        openMethodPicker
      );
      expect(openMethodPicker).toHaveBeenCalledOnce();
      expect(host.logsDialog.open).not.toHaveBeenCalled();
    } finally {
      restoreBluetooth();
      restoreSerial();
    }
  });

  it("still opens OTA logs directly for a non-nRF device on Bluetooth alone", async () => {
    const restoreSerial = withWebSerial(false);
    const restoreBluetooth = withWebBluetooth({});
    const host = makeHost(async () => []);
    const openMethodPicker = vi.fn();
    try {
      await launchLogs(
        host,
        { ...makeDevice(), target_platform: "esp32" },
        openMethodPicker
      );
      expect(openMethodPicker).not.toHaveBeenCalled();
      expect(host.logsDialog.open).toHaveBeenCalledOnce();
    } finally {
      restoreBluetooth();
      restoreSerial();
    }
  });
});
