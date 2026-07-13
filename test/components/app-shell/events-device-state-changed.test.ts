/**
 * Pins the DEVICE_STATE_CHANGED fold: the flat wire event lands in
 * runtime_state.state via fresh device + runtime_state objects (Lit
 * change detection), preserving the other runtime fields.
 */
import { describe, expect, it } from "vitest";
import { DeviceState } from "../../../src/api/types/devices.js";
import { DeviceEventType } from "../../../src/api/types/event-subscription.js";
import type { ESPHomeApp } from "../../../src/components/app-shell.js";
import { handleEvent } from "../../../src/components/app-shell/events.js";
import { makeConfiguredDevice } from "../../_make-configured-device.js";

type Host = Pick<ESPHomeApp, "_devices">;

function dispatch(host: Host, configuration: string, state: DeviceState): void {
  handleEvent(host as ESPHomeApp, DeviceEventType.DEVICE_STATE_CHANGED, {
    configuration,
    state,
  });
}

describe("handleEvent DEVICE_STATE_CHANGED", () => {
  it("folds the flat event state into the device's runtime_state", () => {
    const device = makeConfiguredDevice({
      runtime_state: { deployed_version: "2026.6.1", queued_update: true },
    });
    const host: Host = { _devices: [device] };

    dispatch(host, "kitchen.yaml", DeviceState.ONLINE);

    const updated = host._devices[0];
    expect(updated.runtime_state.state).toBe(DeviceState.ONLINE);
    // Sibling runtime fields survive the fold.
    expect(updated.runtime_state.deployed_version).toBe("2026.6.1");
    expect(updated.runtime_state.queued_update).toBe(true);
    // The fold replaces, never mutates — fresh identities for Lit
    // change detection, so the original device is untouched.
    expect(device.runtime_state.state).toBe(DeviceState.UNKNOWN);
  });

  it("leaves non-matching devices untouched by reference", () => {
    const other = makeConfiguredDevice({ configuration: "bedroom.yaml" });
    const host: Host = { _devices: [other, makeConfiguredDevice()] };

    dispatch(host, "kitchen.yaml", DeviceState.OFFLINE);

    expect(host._devices[0]).toBe(other);
    expect(host._devices[1].runtime_state.state).toBe(DeviceState.OFFLINE);
  });
});
