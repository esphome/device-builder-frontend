import { describe, expect, it } from "vitest";

import type {
  AutomationLocation,
  AutomationTree,
  AvailableComponentInstance,
} from "../../../../src/api/types/automations.js";
import type { LocalizeFunc } from "../../../../src/common/localize.js";
import {
  bareTriggerKey,
  catalogTriggerIdFor,
  effectiveTriggerIdFor,
  targetMetadataValue,
} from "../../../../src/components/device/automation-editor/trigger-identity.js";

const localize: LocalizeFunc = (key, values) => (values ? `${key}#${values.index}` : key);

const inst = (
  over: Partial<AvailableComponentInstance> & { id: string; component_id: string }
): AvailableComponentInstance => over;

const relay = inst({ id: "relay_1", component_id: "switch.gpio", name: "Warmtepomp" });
const devices = [relay];

const tree = (trigger_id: string | null = null): AutomationTree => ({
  trigger_id,
  trigger_params: {},
  actions: [],
});

const componentOn = (trigger: string): AutomationLocation => ({
  kind: "component_on",
  component_id: "relay_1",
  trigger,
});

describe("bareTriggerKey", () => {
  it("drops the domain prefix from a catalog id", () => {
    expect(bareTriggerKey("switch.on_turn_on")).toBe("on_turn_on");
  });

  it("passes an already-bare key through", () => {
    expect(bareTriggerKey("on_boot")).toBe("on_boot");
  });
});

describe("catalogTriggerIdFor", () => {
  it("qualifies a component_on trigger with the bound device's domain", () => {
    expect(catalogTriggerIdFor(componentOn("on_turn_on"), devices)).toBe(
      "switch.on_turn_on"
    );
  });

  it("falls back to the bare key when the device isn't loaded yet", () => {
    expect(catalogTriggerIdFor(componentOn("on_turn_on"), [])).toBe("on_turn_on");
  });

  it("returns null without a picked trigger or for other location kinds", () => {
    expect(catalogTriggerIdFor(componentOn(""), devices)).toBeNull();
    expect(catalogTriggerIdFor({ kind: "script", id: "s" }, devices)).toBeNull();
  });
});

describe("effectiveTriggerIdFor", () => {
  it("prefers the tree's own trigger_id", () => {
    expect(
      effectiveTriggerIdFor(tree("binary_sensor.on_press"), componentOn("x"), devices)
    ).toBe("binary_sensor.on_press");
  });

  it("mirrors a device_on location's trigger as-is (no domain prefix)", () => {
    expect(
      effectiveTriggerIdFor(tree(), { kind: "device_on", trigger: "on_boot" }, devices)
    ).toBe("on_boot");
  });

  it("qualifies a component_on location's bare trigger key", () => {
    expect(effectiveTriggerIdFor(tree(), componentOn("on_turn_on"), devices)).toBe(
      "switch.on_turn_on"
    );
  });

  it("returns null when neither the tree nor the location carries one", () => {
    expect(effectiveTriggerIdFor(tree(), { kind: "interval", index: 0 }, devices)).toBe(
      null
    );
    expect(effectiveTriggerIdFor(tree(), null, devices)).toBeNull();
  });
});

describe("targetMetadataValue", () => {
  it("labels device_on as the device itself", () => {
    expect(
      targetMetadataValue({ kind: "device_on", trigger: "" }, devices, localize)
    ).toBe("device.automation_target_device");
  });

  it("labels component_on with the instance name + catalog id", () => {
    expect(targetMetadataValue(componentOn("on_turn_on"), devices, localize)).toBe(
      "Warmtepomp (switch.gpio)"
    );
  });

  it("falls back to the raw component_id when the device isn't loaded", () => {
    expect(targetMetadataValue(componentOn("on_turn_on"), [], localize)).toBe("relay_1");
  });

  it("labels interval with its 1-based index", () => {
    expect(targetMetadataValue({ kind: "interval", index: 2 }, devices, localize)).toBe(
      "device.automation_target_interval_n#3"
    );
  });

  it("uses the location's own identity for the remaining kinds", () => {
    expect(targetMetadataValue({ kind: "script", id: "boot" }, devices, localize)).toBe(
      "boot"
    );
    expect(
      targetMetadataValue({ kind: "api_action", action_name: "ring" }, devices, localize)
    ).toBe("ring");
    expect(
      targetMetadataValue(
        { kind: "light_effect", component_id: "light.rgb", index: 0 },
        devices,
        localize
      )
    ).toBe("light.rgb");
  });
});
