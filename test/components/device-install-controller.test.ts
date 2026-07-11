/**
 * Pins DeviceInstallController.deviceState: the host device's
 * runtime_state.state, or UNKNOWN before the device loads.
 */
import { describe, expect, it, vi } from "vitest";
import type { ESPHomeAPI } from "../../src/api/index.js";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import { DeviceState } from "../../src/api/types/devices.js";
import {
  DeviceInstallController,
  type DeviceInstallControllerHost,
} from "../../src/components/device/device-install-controller.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";
import { withWebSerial } from "../_web-serial.js";

type LogsDialogStub = {
  configuration?: string;
  name?: string;
  open: ReturnType<typeof vi.fn>;
  openPassive: ReturnType<typeof vi.fn>;
};

function makeHost(
  device: ConfiguredDevice | null,
  logsDialog: LogsDialogStub | null = null
): DeviceInstallControllerHost {
  return {
    device,
    commandDialog: null,
    firmwareDialog: null,
    logsDialog: logsDialog as DeviceInstallControllerHost["logsDialog"],
    api: {} as ESPHomeAPI,
    localize: (key: string) => key,
    addController: vi.fn(),
    removeController: vi.fn(),
    requestUpdate: vi.fn(),
    updateComplete: Promise.resolve(true),
  };
}

describe("DeviceInstallController.deviceState", () => {
  it("returns the device's runtime state", () => {
    const host = makeHost(
      makeConfiguredDevice({ runtime_state: { state: DeviceState.OFFLINE } })
    );
    expect(new DeviceInstallController(host).deviceState).toBe(DeviceState.OFFLINE);
  });

  it("falls back to UNKNOWN with no device loaded", () => {
    expect(new DeviceInstallController(makeHost(null)).deviceState).toBe(
      DeviceState.UNKNOWN
    );
  });
});

describe("DeviceInstallController.methodMode", () => {
  it("defaults to install", () => {
    expect(new DeviceInstallController(makeHost(null)).methodMode).toBe("install");
  });

  it("flips to logs while the picker serves a Logs request, then back on select", () => {
    const restore = withWebSerial(true);
    try {
      const logsDialog: LogsDialogStub = { open: vi.fn(), openPassive: vi.fn() };
      const ctrl = new DeviceInstallController(
        makeHost(makeConfiguredDevice(), logsDialog)
      );

      ctrl.onLogs();
      expect(ctrl.installMethodOpen).toBe(true);
      expect(ctrl.methodMode).toBe("logs");

      ctrl.onInstallMethodSelect(
        new CustomEvent("select-method", { detail: { method: "ota" } })
      );
      expect(ctrl.installMethodOpen).toBe(false);
      expect(ctrl.methodMode).toBe("install");
      expect(logsDialog.open).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("stays install for a normal Install request", () => {
    const ctrl = new DeviceInstallController(makeHost(makeConfiguredDevice()));
    ctrl.onInstall();
    expect(ctrl.installMethodOpen).toBe(true);
    expect(ctrl.methodMode).toBe("install");
  });
});
