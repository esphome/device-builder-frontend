import { describe, expect, it } from "vitest";
import type { ConfiguredDevice } from "../../src/api/types.js";
import { DeviceState } from "../../src/api/types.js";
import { matchesDeviceName } from "../../src/util/device-search.js";

function _device(overrides: Partial<ConfiguredDevice> = {}): ConfiguredDevice {
  return {
    name: "kitchen",
    friendly_name: "Kitchen Lamp",
    configuration: "kitchen.yaml",
    address: "kitchen.local",
    ip_addresses: [],
    state: DeviceState.ONLINE,
    target_platform: "esp32",
    target_variant: "",
    deployed_version: null,
    deployed_config_hash: null,
    expected_config_hash: null,
    api_encryption_active: null,
    has_pending_changes: null,
    last_seen: null,
    just_created: null,
    loaded_integrations: [],
    archived: false,
    ...overrides,
  } as ConfiguredDevice;
}

describe("matchesDeviceName", () => {
  it("matches on friendly_name substring (case-insensitive — caller pre-lowers)", () => {
    expect(matchesDeviceName(_device(), "kitchen")).toBe(true);
    expect(matchesDeviceName(_device(), "lamp")).toBe(true);
    expect(matchesDeviceName(_device(), "tch")).toBe(true);
  });

  it("falls back to device name when friendly_name is empty", () => {
    const d = _device({ friendly_name: "" });
    expect(matchesDeviceName(d, "kitchen")).toBe(true);
    // Friendly_name is empty, so substring matches against ``name`` only.
    expect(matchesDeviceName(d, "lamp")).toBe(false);
  });

  it("matches on configuration filename", () => {
    expect(matchesDeviceName(_device(), "kitchen.yaml")).toBe(true);
    expect(matchesDeviceName(_device(), ".yaml")).toBe(true);
  });

  it("returns false when neither name nor configuration contain the query", () => {
    expect(matchesDeviceName(_device(), "bedroom")).toBe(false);
  });

  it("treats the query as an opaque substring — caller pre-lowers", () => {
    // The query should already be lower-cased by the caller. Pass an
    // upper-cased query and confirm we don't match the lower-cased
    // device fields — pinning the contract so a refactor that adds
    // an internal toLowerCase doesn't silently shift the cost
    // back per-device.
    expect(matchesDeviceName(_device(), "KITCHEN")).toBe(false);
  });

  it("returns true for empty query — every device matches", () => {
    // Empty-substring is a subset of every string. Callers gate
    // empty queries themselves (no filter) so this isn't a problem
    // in practice; pin the predicate's actual behaviour.
    expect(matchesDeviceName(_device(), "")).toBe(true);
  });
});
