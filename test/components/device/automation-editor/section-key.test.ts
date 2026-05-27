/**
 * Round-trip tests for the section-key ↔ AutomationLocation
 * conversion. The synchronous fallback in ``parseYamlAutomations``
 * emits these keys, and the page consumes them to mount the
 * automation editor with the right location.
 */
import { describe, expect, it } from "vitest";
import {
  locationFromSectionKey,
  sectionKeyFromLocation,
} from "../../../../src/components/device/automation-editor/serialise.js";
import type { AutomationLocation } from "../../../../src/api/types.js";

describe("sectionKeyFromLocation", () => {
  it("emits the same shape parseYamlAutomations uses", () => {
    expect(sectionKeyFromLocation({ kind: "device_on", trigger: "on_boot" })).toBe(
      "automation:device_on:on_boot"
    );
    expect(
      sectionKeyFromLocation({
        kind: "component_on",
        component_id: "my_button",
        trigger: "on_press",
      })
    ).toBe("automation:component_on:my_button:on_press");
    expect(sectionKeyFromLocation({ kind: "script", id: "my_alarm" })).toBe(
      "automation:script:my_alarm"
    );
    expect(sectionKeyFromLocation({ kind: "interval", index: 2 })).toBe(
      "automation:interval:2"
    );
    expect(
      sectionKeyFromLocation({
        kind: "light_effect",
        component_id: "strip",
        index: 0,
      })
    ).toBe("automation:light_effect:strip:0");
    expect(
      sectionKeyFromLocation({
        kind: "api_action",
        action_name: "start_laundry",
      })
    ).toBe("automation:api_action:start_laundry");
  });
});

describe("locationFromSectionKey", () => {
  it("rejects non-automation keys", () => {
    expect(locationFromSectionKey("wifi")).toBeNull();
    expect(locationFromSectionKey("binary_sensor.gpio")).toBeNull();
  });

  it("rejects unrecognised automation kinds", () => {
    expect(locationFromSectionKey("automation:unscoped:on_press:5")).toBeNull();
    expect(locationFromSectionKey("automation:nope")).toBeNull();
  });

  it("rejects malformed keys", () => {
    expect(locationFromSectionKey("automation:device_on:")).toBeNull();
    expect(locationFromSectionKey("automation:component_on:my_button")).toBeNull();
    expect(locationFromSectionKey("automation:interval:notanumber")).toBeNull();
    expect(locationFromSectionKey("automation:api_action:")).toBeNull();
  });

  const cases: [string, AutomationLocation][] = [
    ["automation:device_on:on_boot", { kind: "device_on", trigger: "on_boot" }],
    [
      "automation:component_on:my_button:on_press",
      { kind: "component_on", component_id: "my_button", trigger: "on_press" },
    ],
    ["automation:script:my_alarm", { kind: "script", id: "my_alarm" }],
    ["automation:interval:2", { kind: "interval", index: 2 }],
    [
      "automation:light_effect:strip:0",
      { kind: "light_effect", component_id: "strip", index: 0 },
    ],
    [
      "automation:api_action:start_laundry",
      { kind: "api_action", action_name: "start_laundry" },
    ],
  ];

  for (const [key, expected] of cases) {
    it(`round-trips ${key}`, () => {
      const loc = locationFromSectionKey(key);
      expect(loc).toEqual(expected);
      expect(sectionKeyFromLocation(loc!)).toBe(key);
    });
  }
});
