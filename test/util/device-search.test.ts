import { describe, expect, it } from "vitest";
import type { ConfiguredDevice } from "../../src/api/types.js";
import { DeviceState } from "../../src/api/types.js";
import { matchesDeviceName, matchesMacAddress } from "../../src/util/device-search.js";

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

describe("matchesMacAddress", () => {
  const MAC = "94:c9:60:12:34:56";

  it("matches the canonical colon-separated form (caller pre-lowers)", () => {
    expect(matchesMacAddress(MAC, "94:c9:60")).toBe(true);
  });

  it("matches regardless of which separators the query uses", () => {
    // Users copy-paste from router pages / vendor labels with `-`,
    // `.`, or no separators at all — all should find the device.
    expect(matchesMacAddress(MAC, "94-c9-60")).toBe(true);
    expect(matchesMacAddress(MAC, "94.c9.60")).toBe(true);
    expect(matchesMacAddress(MAC, "94c960")).toBe(true);
  });

  it("matches a stored MAC that itself uses non-colon separators", () => {
    expect(matchesMacAddress("94-C9-60-12-34-56".toLowerCase(), "94c9")).toBe(true);
  });

  it("matches an interior substring of the address", () => {
    expect(matchesMacAddress(MAC, "123456")).toBe(true);
  });

  it("returns false when the stripped query is not a substring", () => {
    expect(matchesMacAddress(MAC, "aabbcc")).toBe(false);
  });

  it("returns false for an empty / missing MAC", () => {
    expect(matchesMacAddress("", "94c960")).toBe(false);
    expect(matchesMacAddress(null, "94c960")).toBe(false);
    expect(matchesMacAddress(undefined, "94c960")).toBe(false);
  });

  it("returns false when the query is empty once separators are stripped", () => {
    // A bare separator query (":", "-", "::") must not match every
    // device — otherwise it would behave like an empty (match-all)
    // needle against the stripped haystack.
    expect(matchesMacAddress(MAC, "")).toBe(false);
    expect(matchesMacAddress(MAC, ":")).toBe(false);
    expect(matchesMacAddress(MAC, "-:.")).toBe(false);
  });
});
