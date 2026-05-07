/**
 * Tests for the labels-filter helpers.
 *
 * These all live as pure functions (rather than methods on the
 * filter component) so vitest's ``node`` environment can exercise
 * the logic without dragging in webawesome's DOM-coupled side-
 * effect modules — the same constraint the drawer's
 * ``render-ip-value.test.ts`` works around.
 */
import { describe, expect, it } from "vitest";
import type { ConfiguredDevice } from "../../src/api/types.js";
import { DeviceState } from "../../src/api/types.js";
import {
  computeLabelUsage,
  deleteConfirmKey,
  isLabelNameDuplicate,
  type LabelUsageDevice,
} from "../../src/util/label-usage.js";

const _baseDevice = {
  name: "kitchen",
  friendly_name: "Kitchen",
  configuration: "kitchen.yaml",
  comment: null,
  area: "",
  board_id: "esp32-c3-devkitm-1",
  target_platform: "esp32",
  address: "kitchen.local",
  ip: "",
  ip_addresses: [],
  mac_address: "",
  ethernet_mac: "",
  bluetooth_mac: "",
  build_size_bytes: 0,
  labels: [],
  web_port: null,
  current_version: "",
  deployed_version: "",
  loaded_integrations: [],
  state: DeviceState.UNKNOWN,
  expected_config_hash: "",
  deployed_config_hash: "",
  has_pending_changes: false,
  update_available: false,
  api_enabled: false,
  api_encrypted: false,
  api_encryption_active: null,
} satisfies ConfiguredDevice;

function _device(overrides: Partial<ConfiguredDevice> = {}): ConfiguredDevice {
  return { ..._baseDevice, ...overrides };
}

describe("computeLabelUsage", () => {
  it("returns an empty object for an empty device list", () => {
    expect(computeLabelUsage([])).toEqual({});
  });

  it("counts occurrences across multiple devices", () => {
    const devices = [
      _device({ labels: ["kitchen", "bluetooth_proxy"] }),
      _device({ name: "bedroom", labels: ["bedroom", "bluetooth_proxy"] }),
      _device({ name: "garage", labels: ["bluetooth_proxy"] }),
    ];
    expect(computeLabelUsage(devices)).toEqual({
      kitchen: 1,
      bedroom: 1,
      bluetooth_proxy: 3,
    });
  });

  it("treats absent and empty labels as no-op", () => {
    // ``computeLabelUsage`` is typed against the loose
    // ``LabelUsageDevice`` shape (``labels?: readonly string[] | null``)
    // so the helper covers both wire shapes — current ``ConfiguredDevice``
    // payloads always include ``labels: []``, but the helper is robust
    // to a future "no labels block" or explicit-null sentinel without
    // a regression here.
    const devices: LabelUsageDevice[] = [
      { labels: ["kitchen"] },
      { labels: null },
      { labels: undefined },
      {}, // labels field omitted entirely
      { labels: [] },
    ];
    expect(computeLabelUsage(devices)).toEqual({ kitchen: 1 });
  });

  it("omits keys for unused labels (caller treats missing as zero)", () => {
    const devices = [_device({ labels: ["kitchen"] })];
    const usage = computeLabelUsage(devices);
    expect(usage).not.toHaveProperty("bedroom");
    // The delete-confirm dialog reads ``usage[id] ?? 0`` so an
    // omitted key gives the same answer as an explicit 0.
    expect(usage["bedroom"] ?? 0).toBe(0);
  });
});

describe("deleteConfirmKey", () => {
  it("returns the zero-key when no devices carry the label", () => {
    expect(deleteConfirmKey(0)).toBe("dashboard.labels_delete_confirm_zero");
  });

  it("returns the one-key for exactly one device", () => {
    expect(deleteConfirmKey(1)).toBe("dashboard.labels_delete_confirm_one");
  });

  it("returns the other-key for any count > 1", () => {
    expect(deleteConfirmKey(2)).toBe("dashboard.labels_delete_confirm_other");
    expect(deleteConfirmKey(7)).toBe("dashboard.labels_delete_confirm_other");
    expect(deleteConfirmKey(99)).toBe("dashboard.labels_delete_confirm_other");
  });
});

describe("isLabelNameDuplicate", () => {
  it("flags a name already in the catalog (case-insensitive)", () => {
    expect(isLabelNameDuplicate("Kitchen", ["Bedroom", "Kitchen"], null)).toBe(
      true,
    );
    expect(isLabelNameDuplicate("kitchen", ["Bedroom", "Kitchen"], null)).toBe(
      true,
    );
    expect(isLabelNameDuplicate("KITCHEN", ["Bedroom", "Kitchen"], null)).toBe(
      true,
    );
  });

  it("ignores leading/trailing whitespace", () => {
    expect(isLabelNameDuplicate("  Kitchen  ", ["Kitchen"], null)).toBe(true);
  });

  it("does not flag a fresh name", () => {
    expect(isLabelNameDuplicate("Garage", ["Bedroom", "Kitchen"], null)).toBe(
      false,
    );
  });

  it("treats an empty / whitespace-only name as non-duplicate", () => {
    // Empty input is invalid in its own right; the form's other
    // guards reject it. The dedup helper just shouldn't false-
    // positive against a sentinel empty string.
    expect(isLabelNameDuplicate("", ["Kitchen"], null)).toBe(false);
    expect(isLabelNameDuplicate("   ", ["Kitchen"], null)).toBe(false);
  });

  it("excludes the editing label's own current name", () => {
    // User opened "Kitchen" for edit and types its name again —
    // shouldn't flag as duplicate.
    expect(
      isLabelNameDuplicate("Kitchen", ["Bedroom", "Kitchen"], "Kitchen"),
    ).toBe(false);
    // Case-insensitive exclusion: typed casing differs from the
    // stored casing, but the editing-name match still applies.
    expect(
      isLabelNameDuplicate("kitchen", ["Bedroom", "Kitchen"], "Kitchen"),
    ).toBe(false);
  });

  it("still flags a name that collides with a different existing label in edit mode", () => {
    // User editing "Kitchen" tries to rename it to "Bedroom" —
    // that's a real collision.
    expect(
      isLabelNameDuplicate("Bedroom", ["Bedroom", "Kitchen"], "Kitchen"),
    ).toBe(true);
  });
});
