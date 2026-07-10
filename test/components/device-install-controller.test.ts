/**
 * Pins DeviceInstallController.deviceState: the host device's
 * runtime_state.state, or UNKNOWN before the device loads.
 */
import { describe, expect, it, vi } from "vitest";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import { DeviceState } from "../../src/api/types/devices.js";
import {
  DeviceInstallController,
  type DeviceInstallControllerHost,
} from "../../src/components/device/device-install-controller.js";
import { makeConfiguredDevice } from "../_make-configured-device.js";

function makeHost(device: ConfiguredDevice | null): DeviceInstallControllerHost {
  return {
    device,
    commandDialog: null,
    firmwareDialog: null,
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
