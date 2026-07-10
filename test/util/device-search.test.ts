import { describe, expect, it } from "vitest";
import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import {
  matchesDeviceName,
  matchesDeviceRow,
  matchesMacAddress,
  type DeviceRowSearchFields,
} from "../../src/util/device-search.js";
import {
  type ConfiguredDeviceOverrides,
  makeConfiguredDevice,
} from "../_make-configured-device.js";

function _device(overrides: ConfiguredDeviceOverrides = {}): ConfiguredDevice {
  return makeConfiguredDevice({ friendly_name: "Kitchen Lamp", ...overrides });
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

describe("matchesDeviceRow", () => {
  function _row(overrides: Partial<DeviceRowSearchFields> = {}): DeviceRowSearchFields {
    return {
      name: "kitchen",
      friendly_name: "Kitchen Lamp",
      config: "kitchen.yaml",
      address: "kitchen.local",
      ip_addresses: ["192.168.1.42"],
      platform: "esp32",
      mac_address: "94:c9:60:12:34:56",
      ...overrides,
    };
  }

  it("matches on friendly_name (falling back to name when empty)", () => {
    expect(matchesDeviceRow(_row(), "lamp")).toBe(true);
    expect(matchesDeviceRow(_row({ friendly_name: "" }), "kitchen")).toBe(true);
    expect(matchesDeviceRow(_row({ friendly_name: "" }), "lamp")).toBe(false);
  });

  it("matches on config, address, IP and platform fields", () => {
    expect(matchesDeviceRow(_row(), ".yaml")).toBe(true);
    expect(matchesDeviceRow(_row(), "kitchen.local")).toBe(true);
    expect(matchesDeviceRow(_row(), "192.168.1.42")).toBe(true);
    expect(matchesDeviceRow(_row(), "esp32")).toBe(true);
  });

  it("matches across any of several IP addresses", () => {
    const row = _row({ ip_addresses: ["10.0.0.1", "10.0.0.2"] });
    expect(matchesDeviceRow(row, "10.0.0.2")).toBe(true);
  });

  it("matches on MAC address via the shared separator-insensitive rule", () => {
    expect(matchesDeviceRow(_row(), "94c9")).toBe(true);
    expect(matchesDeviceRow(_row(), "94-c9-60")).toBe(true);
  });

  it("returns false when no field contains the query", () => {
    expect(matchesDeviceRow(_row(), "bedroom")).toBe(false);
  });

  it("matches every row on an empty query (cleared search box)", () => {
    expect(matchesDeviceRow(_row(), "")).toBe(true);
  });

  it("tolerates a missing MAC without matching on it", () => {
    const row = _row({ mac_address: null });
    expect(matchesDeviceRow(row, "94c9")).toBe(false);
    // Other fields still match.
    expect(matchesDeviceRow(row, "lamp")).toBe(true);
  });
});
