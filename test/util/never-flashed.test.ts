// Pins the evidence set: deploy-side fields only (deployed_version /
// deployed_config_hash / mac_address / currently ONLINE), never
// compile-side ones a deferred compile would set itself.
import { describe, expect, it } from "vitest";
import { DeviceState } from "../../src/api/types/devices.js";
import { isNeverFlashed } from "../../src/util/never-flashed.js";
import {
  makeConfiguredDevice,
  type ConfiguredDeviceOverrides,
} from "../_make-configured-device.js";

describe("isNeverFlashed", () => {
  it("is true for a fresh device with no deploy evidence", () => {
    expect(isNeverFlashed(makeConfiguredDevice())).toBe(true);
  });

  it("stays true when the ping sweep marked it offline", () => {
    const device = makeConfiguredDevice({
      runtime_state: { state: DeviceState.OFFLINE },
    });
    expect(isNeverFlashed(device)).toBe(true);
  });

  it("is false while the device is online, evidence or not", () => {
    const device = makeConfiguredDevice({
      runtime_state: { state: DeviceState.ONLINE },
    });
    expect(isNeverFlashed(device)).toBe(false);
  });

  it.each([
    ["deployed_version", { runtime_state: { deployed_version: "2026.6.0" } }],
    ["deployed_config_hash", { runtime_state: { deployed_config_hash: "5a94a12d" } }],
    ["mac_address", { mac_address: "94:C9:60:1F:8C:F1" }],
  ] as [string, ConfiguredDeviceOverrides][])(
    "is false with %s evidence on an offline device",
    (_field, overrides) => {
      const device = makeConfiguredDevice({
        ...overrides,
        runtime_state: { state: DeviceState.OFFLINE, ...overrides.runtime_state },
      });
      expect(isNeverFlashed(device)).toBe(false);
    }
  );

  it("ignores compile evidence — a deferred compile must not flip it", () => {
    const device = makeConfiguredDevice({
      expected_config_hash: "f3e21d5a",
      build_size_bytes: 1024 * 1024,
    });
    expect(isNeverFlashed(device)).toBe(true);
  });

  it("is false for a missing device", () => {
    expect(isNeverFlashed(null)).toBe(false);
    expect(isNeverFlashed(undefined)).toBe(false);
  });
});
