import { afterEach, describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../../src/api/index.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { openLogs } from "../../../src/components/dashboard/install.js";
import type { ESPHomePageDashboard } from "../../../src/pages/dashboard.js";

function makeDevice(): ConfiguredDevice {
  return {
    name: "kitchen",
    friendly_name: "Kitchen",
    configuration: "kitchen.yaml",
  } as ConfiguredDevice;
}

interface StubHost {
  _api: Pick<ESPHomeAPI, "getSerialPorts">;
  _logsDialog: { configuration?: string; name?: string; open: ReturnType<typeof vi.fn> };
  _installMethodDevice?: ConfiguredDevice;
  _installMethodMode?: "install" | "logs";
  _installMethodOpen: boolean;
}

function makeHost(getSerialPorts: () => Promise<unknown>): StubHost {
  return {
    _api: { getSerialPorts: vi.fn(getSerialPorts) } as unknown as StubHost["_api"],
    _logsDialog: { open: vi.fn() },
    _installMethodOpen: false,
  };
}

/** Toggle `navigator.serial` presence; returns a restore function. */
function withWebSerial(present: boolean): () => void {
  const had = "serial" in navigator;
  const previous = (navigator as unknown as { serial?: unknown }).serial;
  if (present) {
    Object.defineProperty(navigator, "serial", { configurable: true, value: {} });
  } else if (had) {
    delete (navigator as unknown as { serial?: unknown }).serial;
  }
  return () => {
    if (had) {
      Object.defineProperty(navigator, "serial", { configurable: true, value: previous });
    } else {
      delete (navigator as unknown as { serial?: unknown }).serial;
    }
  };
}

describe("openLogs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the method picker when WebSerial is available, without touching the backend", async () => {
    const restore = withWebSerial(true);
    try {
      const host = makeHost(async () => []);
      await openLogs(host as unknown as ESPHomePageDashboard, makeDevice());

      expect(host._installMethodOpen).toBe(true);
      expect(host._installMethodMode).toBe("logs");
      expect(host._installMethodDevice?.configuration).toBe("kitchen.yaml");
      expect(host._logsDialog.open).not.toHaveBeenCalled();
      // WebSerial alone is a serial path; no need to enumerate server ports.
      expect(host._api.getSerialPorts).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("opens the method picker when the server reports serial ports (no WebSerial)", async () => {
    const restore = withWebSerial(false);
    try {
      const host = makeHost(async () => [{ port: "/dev/ttyUSB0", desc: "USB serial" }]);
      await openLogs(host as unknown as ESPHomePageDashboard, makeDevice());

      expect(host._api.getSerialPorts).toHaveBeenCalledTimes(1);
      expect(host._installMethodOpen).toBe(true);
      expect(host._installMethodMode).toBe("logs");
      expect(host._logsDialog.open).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("opens OTA logs directly when there is no serial path at all", async () => {
    const restore = withWebSerial(false);
    try {
      const host = makeHost(async () => []);
      await openLogs(host as unknown as ESPHomePageDashboard, makeDevice());

      expect(host._installMethodOpen).toBe(false);
      expect(host._logsDialog.open).toHaveBeenCalledTimes(1);
      expect(host._logsDialog.configuration).toBe("kitchen.yaml");
      expect(host._logsDialog.name).toBe("Kitchen");
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
      await openLogs(host as unknown as ESPHomePageDashboard, makeDevice());

      expect(host._installMethodOpen).toBe(false);
      expect(host._logsDialog.open).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });
});
