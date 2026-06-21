/**
 * Pins the dashboard's pure filter pipeline: facet narrowing
 * (labels / area / platform / state / update-status with their
 * AND-vs-OR semantics), the "are filters active?" / "facet pill
 * count" helpers, and the card-vs-table search predicate.
 */
import { describe, expect, it } from "vitest";

import type { ConfiguredDevice } from "../../src/api/types/devices.js";
import { DeviceState } from "../../src/api/types/devices.js";
import {
  activeFacetCount,
  applyFacetFilters,
  type FacetSelection,
  hasActiveFilters,
  matchesDeviceSearch,
} from "../../src/util/device-filter.js";

function device(over: Partial<ConfiguredDevice> = {}): ConfiguredDevice {
  return {
    name: "kitchen",
    friendly_name: "Kitchen Lamp",
    configuration: "kitchen.yaml",
    address: "kitchen.local",
    ip_addresses: [],
    state: DeviceState.ONLINE,
    target_platform: "esp32",
    mac_address: "",
    labels: [],
    area: "",
    update_available: false,
    has_pending_changes: false,
    ...over,
  } as ConfiguredDevice;
}

const emptySelection: FacetSelection = {
  selectedLabels: [],
  selectedAreas: [],
  selectedPlatforms: [],
  selectedStates: [],
  selectedUpdateStatus: [],
};

function selection(over: Partial<FacetSelection>): FacetSelection {
  return { ...emptySelection, ...over };
}

describe("applyFacetFilters", () => {
  it("returns the list untouched when no facet is active", () => {
    const devices = [device(), device({ name: "bedroom" })];
    expect(applyFacetFilters(devices, emptySelection)).toBe(devices);
  });

  it("labels facet is AND: device must carry every selected label", () => {
    const both = device({ name: "both", labels: ["a", "b"] });
    const onlyA = device({ name: "onlyA", labels: ["a"] });
    const none = device({ name: "none", labels: [] });
    const out = applyFacetFilters(
      [both, onlyA, none],
      selection({ selectedLabels: ["a", "b"] })
    );
    expect(out).toEqual([both]);
  });

  it("labels facet drops devices with null/empty labels", () => {
    const tagged = device({ name: "tagged", labels: ["a"] });
    const untagged = device({ name: "untagged", labels: undefined });
    const out = applyFacetFilters(
      [tagged, untagged],
      selection({ selectedLabels: ["a"] })
    );
    expect(out).toEqual([tagged]);
  });

  it("area facet is OR: device area in the selected set", () => {
    const kitchen = device({ name: "k", area: "Kitchen" });
    const bedroom = device({ name: "b", area: "Bedroom" });
    const office = device({ name: "o", area: "Office" });
    const out = applyFacetFilters(
      [kitchen, bedroom, office],
      selection({ selectedAreas: ["Kitchen", "Bedroom"] })
    );
    expect(out).toEqual([kitchen, bedroom]);
  });

  it("platform facet matches target_platform", () => {
    const esp32 = device({ name: "a", target_platform: "esp32" });
    const esp8266 = device({ name: "b", target_platform: "esp8266" });
    const out = applyFacetFilters(
      [esp32, esp8266],
      selection({ selectedPlatforms: ["esp8266"] })
    );
    expect(out).toEqual([esp8266]);
  });

  it("state facet matches the device state", () => {
    const online = device({ name: "a", state: DeviceState.ONLINE });
    const offline = device({ name: "b", state: DeviceState.OFFLINE });
    const out = applyFacetFilters(
      [online, offline],
      selection({ selectedStates: [DeviceState.OFFLINE] })
    );
    expect(out).toEqual([offline]);
  });

  it("update-status facet is AND across selected buckets", () => {
    const updatable = device({ name: "u", update_available: true });
    const modified = device({ name: "m", has_pending_changes: true });
    const both = device({ name: "b", update_available: true, has_pending_changes: true });
    const out = applyFacetFilters(
      [updatable, modified, both],
      selection({ selectedUpdateStatus: ["update_available", "modified"] })
    );
    expect(out).toEqual([both]);
  });

  it("stacks facets with AND semantics across different facets", () => {
    const match = device({ name: "match", area: "Kitchen", target_platform: "esp32" });
    const wrongArea = device({ name: "wa", area: "Bedroom", target_platform: "esp32" });
    const wrongPlatform = device({
      name: "wp",
      area: "Kitchen",
      target_platform: "esp8266",
    });
    const out = applyFacetFilters(
      [match, wrongArea, wrongPlatform],
      selection({ selectedAreas: ["Kitchen"], selectedPlatforms: ["esp32"] })
    );
    expect(out).toEqual([match]);
  });
});

describe("hasActiveFilters", () => {
  it("is false with no search and no facets", () => {
    expect(hasActiveFilters("", emptySelection)).toBe(false);
  });

  it("is false for a whitespace-only search", () => {
    expect(hasActiveFilters("   ", emptySelection)).toBe(false);
  });

  it("is true for a non-empty search alone", () => {
    expect(hasActiveFilters("lamp", emptySelection)).toBe(true);
  });

  it("is true when any facet is selected", () => {
    expect(hasActiveFilters("", selection({ selectedAreas: ["Kitchen"] }))).toBe(true);
  });
});

describe("activeFacetCount", () => {
  it("counts facets only, ignoring search", () => {
    expect(activeFacetCount(emptySelection)).toBe(0);
    expect(
      activeFacetCount(
        selection({ selectedLabels: ["a", "b"], selectedStates: [DeviceState.ONLINE] })
      )
    ).toBe(3);
  });
});

describe("matchesDeviceSearch", () => {
  const d = device({
    friendly_name: "Kitchen Lamp",
    address: "10.0.0.5",
    ip_addresses: ["192.168.1.20"],
    target_platform: "esp32",
    mac_address: "94:C9:60:AA:BB:CC",
  });

  it("matches on name in both card and table views", () => {
    expect(matchesDeviceSearch(d, "lamp", false)).toBe(true);
    expect(matchesDeviceSearch(d, "lamp", true)).toBe(true);
  });

  it("card view ignores address/IP/platform/MAC", () => {
    expect(matchesDeviceSearch(d, "192.168", false)).toBe(false);
    expect(matchesDeviceSearch(d, "esp32", false)).toBe(false);
    expect(matchesDeviceSearch(d, "94c960", false)).toBe(false);
  });

  it("table view also matches address, IP, platform, and MAC", () => {
    expect(matchesDeviceSearch(d, "10.0.0", true)).toBe(true);
    expect(matchesDeviceSearch(d, "192.168", true)).toBe(true);
    expect(matchesDeviceSearch(d, "esp32", true)).toBe(true);
    expect(matchesDeviceSearch(d, "94c960", true)).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(matchesDeviceSearch(d, "zzz", true)).toBe(false);
  });
});
