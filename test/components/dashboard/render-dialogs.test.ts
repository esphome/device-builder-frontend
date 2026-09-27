/**
 * @vitest-environment happy-dom
 *
 * Pins renderDialogs' install-method dialog bindings: deviceState
 * comes from the selected device's runtime_state, falling back to
 * UNKNOWN when no device is set, and the platform and the chip come
 * from the device too.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../../src/util/post-install-logs.js", () => ({
  attachSerialLogStream: vi.fn(),
  reconnectWebSerialLogs: vi.fn(),
}));

import { renderInto } from "../../_dom.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";
import type { ConfiguredDevice } from "../../../src/api/types/devices.js";
import { DeviceState } from "../../../src/api/types/devices.js";
import { renderDialogs } from "../../../src/components/dashboard/render-dialogs.js";
import type { AnyBrowserInstall } from "../../../src/platforms/platform-support.js";
import { installsFor } from "../../../src/platforms/registry.js";
import { makeDashboardHost } from "./_host.js";

function renderInstallMethodDialog(device: ConfiguredDevice | null) {
  const host = makeDashboardHost({
    _pendingConfirm: null,
    _selectedDevices: new Set<string>(),
    _computeLabelUsage: () => ({}),
    _labelDialogOpen: false,
    _labelDialogEditing: null,
    _selectedLabels: [],
    _installMethodOpen: device !== null,
    _installMethodDevice: device,
    _installMethodMode: "install",
  });
  const container = renderInto(renderDialogs(host));
  const dialog = container.querySelector("esphome-install-method-dialog");
  expect(dialog).not.toBeNull();
  return dialog as HTMLElement & {
    deviceState: DeviceState;
    deviceTargetPlatform: string;
    platformInstalls: readonly AnyBrowserInstall[];
  };
}

describe("renderDialogs install-method dialog", () => {
  it("binds the selected device's runtime state", () => {
    const device = makeConfiguredDevice({
      runtime_state: { state: DeviceState.ONLINE },
    });
    expect(renderInstallMethodDialog(device).deviceState).toBe(DeviceState.ONLINE);
  });

  it("falls back to UNKNOWN when no device is selected", () => {
    expect(renderInstallMethodDialog(null).deviceState).toBe(DeviceState.UNKNOWN);
  });

  it("binds the selected device's platform and the flashers it can take", () => {
    const device = makeConfiguredDevice({ target_platform: "rtl87xx", mcu: "rtl8720c" });
    const dialog = renderInstallMethodDialog(device);
    expect(dialog.deviceTargetPlatform).toBe("rtl87xx");
    expect(dialog.platformInstalls).toEqual(installsFor(device));
    expect(dialog.platformInstalls).toHaveLength(1);
    expect(renderInstallMethodDialog(null).platformInstalls).toEqual([]);
  });
});
