import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import toast from "sonner-js";
import { withWebSerial } from "../_web-serial.js";
import { CommandTimeoutError } from "../../src/api/index.js";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import type { LogsLaunchHost } from "../../src/util/logs-launch.js";
import { launchLogs, launchLogsWithMethod } from "../../src/util/logs-launch.js";

function makeDevice(): ConfiguredDevice {
  return {
    name: "kitchen",
    friendly_name: "Kitchen",
    configuration: "kitchen.yaml",
  } as ConfiguredDevice;
}

function makeHost(getSerialPorts: () => Promise<unknown>): LogsLaunchHost & {
  logsDialog: { configuration?: string; name?: string; open: ReturnType<typeof vi.fn> };
} {
  return {
    api: { getSerialPorts: vi.fn(getSerialPorts) },
    logsDialog: { open: vi.fn() },
    localize: (key: string) => key,
  } as unknown as LogsLaunchHost & {
    logsDialog: { configuration?: string; name?: string; open: ReturnType<typeof vi.fn> };
  };
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
  it("routes ota to a portless open()", async () => {
    const host = makeHost(async () => []);
    await launchLogsWithMethod(host, makeDevice(), "ota");
    expect(host.logsDialog.open).toHaveBeenCalledWith();
    expect(host.logsDialog.configuration).toBe("kitchen.yaml");
    expect(host.logsDialog.name).toBe("Kitchen");
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
