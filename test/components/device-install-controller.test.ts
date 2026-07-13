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
  logsDialog: LogsDialogStub | null = null,
  overrides: Partial<DeviceInstallControllerHost> = {}
): DeviceInstallControllerHost {
  return {
    device,
    commandDialog: null,
    firmwareDialog: null,
    logsDialog: logsDialog as DeviceInstallControllerHost["logsDialog"],
    api: {} as ESPHomeAPI,
    localize: (key: string) => key,
    openActiveJobProgress: () => false,
    addController: vi.fn(),
    removeController: vi.fn(),
    requestUpdate: vi.fn(),
    updateComplete: Promise.resolve(true),
    ...overrides,
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

// Pins the controller's install seams' busy guard (#1194).
describe("DeviceInstallController busy seam guard", () => {
  function makeBusyParts(busy: boolean) {
    const openForDevice = vi.fn();
    const openActiveJobProgress = vi.fn(() => busy);
    const host = makeHost(makeConfiguredDevice(), null, {
      commandDialog: {
        openForDevice,
      } as unknown as DeviceInstallControllerHost["commandDialog"],
      openActiveJobProgress,
    });
    return {
      ctrl: new DeviceInstallController(host),
      openForDevice,
      openActiveJobProgress,
    };
  }

  it("onInstall re-attaches instead of opening the picker while busy", () => {
    const { ctrl, openActiveJobProgress } = makeBusyParts(true);
    ctrl.onInstall();
    expect(openActiveJobProgress).toHaveBeenCalledTimes(1);
    expect(ctrl.installMethodOpen).toBe(false);
  });

  it("onUpdate re-attaches instead of enqueuing while busy", () => {
    const { ctrl, openForDevice, openActiveJobProgress } = makeBusyParts(true);
    ctrl.onUpdate();
    expect(openActiveJobProgress).toHaveBeenCalledTimes(1);
    expect(openForDevice).not.toHaveBeenCalled();
  });

  it("a job started while the picker sat open blocks the select from superseding", () => {
    const { ctrl, openForDevice, openActiveJobProgress } = makeBusyParts(false);
    ctrl.onInstall();
    expect(ctrl.installMethodOpen).toBe(true);
    // The race: a job starts (second tab, deferred update firing) mid-picker.
    openActiveJobProgress.mockReturnValue(true);
    ctrl.onInstallMethodSelect(
      new CustomEvent("select-method", { detail: { method: "ota" } })
    );
    expect(ctrl.installMethodOpen).toBe(false);
    expect(openForDevice).not.toHaveBeenCalled();
  });

  it("an idle select still enqueues the install", () => {
    const { ctrl, openForDevice } = makeBusyParts(false);
    ctrl.onInstall();
    ctrl.onInstallMethodSelect(
      new CustomEvent("select-method", { detail: { method: "ota" } })
    );
    expect(openForDevice).toHaveBeenCalledTimes(1);
  });
});
