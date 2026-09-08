import { describe, expect, it } from "vitest";

import type {
  AutomationLocation,
  AutomationTree,
  AutomationTrigger,
  AvailableComponentInstance,
} from "../../../../src/api/types/automations.js";
import type { LocalizeFunc } from "../../../../src/common/localize.js";
import {
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

const rotary = inst({ id: "dial", component_id: "sensor.rotary_encoder", name: "Dial" });
const subSensor = inst({
  id: "aht20_temperature",
  component_id: "sensor",
  parent_id: "aht20",
});

const trigger = (id: string, applies_to: string[]): AutomationTrigger => ({
  id,
  name: id,
  description: "",
  docs_url: "",
  applies_to,
  is_device_level: false,
  supports_list: false,
  config_entries: [],
});
const clockwise = trigger("rotary_encoder.sensor.on_clockwise", [
  "sensor.rotary_encoder",
]);
const valueRange = trigger("sensor.on_value_range", ["sensor"]);
const turnOn = trigger("switch.on_turn_on", ["switch"]);
const container = inst({
  id: "ltr",
  component_id: "sensor.ltr501",
  is_entity_container: true,
});
const psHigh = trigger("ltr501.sensor.on_ps_high_threshold", ["sensor.ltr501"]);
const triggers = [clockwise, psHigh, valueRange, turnOn];

const tree = (trigger_id: string | null = null): AutomationTree => ({
  trigger_id,
  trigger_params: {},
  actions: [],
});

const componentOn = (trigger: string, component_id = "relay_1"): AutomationLocation => ({
  kind: "component_on",
  component_id,
  trigger,
});

describe("catalogTriggerIdFor", () => {
  it("qualifies a component_on trigger with the bound device's domain", () => {
    expect(catalogTriggerIdFor(componentOn("on_turn_on"), devices, triggers)).toBe(
      "switch.on_turn_on"
    );
  });

  it("resolves a platform-scoped id through the device's offered triggers", () => {
    expect(
      catalogTriggerIdFor(componentOn("on_clockwise", "dial"), [rotary], triggers)
    ).toBe("rotary_encoder.sensor.on_clockwise");
  });

  it("resolves a trigger hosted on a multi-entity container's own item", () => {
    expect(
      catalogTriggerIdFor(
        componentOn("on_ps_high_threshold", "ltr"),
        [container],
        triggers
      )
    ).toBe("ltr501.sensor.on_ps_high_threshold");
  });

  it("resolves a sub-entity's trigger to the domain-level id", () => {
    expect(
      catalogTriggerIdFor(
        componentOn("on_value_range", "aht20_temperature"),
        [subSensor],
        triggers
      )
    ).toBe("sensor.on_value_range");
  });

  it("falls back to the bare key when the device or its trigger is unknown", () => {
    expect(catalogTriggerIdFor(componentOn("on_turn_on"), [], triggers)).toBe(
      "on_turn_on"
    );
    expect(catalogTriggerIdFor(componentOn("on_turn_on"), devices, [])).toBe(
      "on_turn_on"
    );
  });

  it("returns null without a picked trigger or for other location kinds", () => {
    expect(catalogTriggerIdFor(componentOn(""), devices, triggers)).toBeNull();
    expect(
      catalogTriggerIdFor({ kind: "script", id: "s" }, devices, triggers)
    ).toBeNull();
  });
});

describe("effectiveTriggerIdFor", () => {
  it("prefers the tree's own trigger_id", () => {
    expect(
      effectiveTriggerIdFor(
        tree("binary_sensor.on_press"),
        componentOn("x"),
        devices,
        triggers
      )
    ).toBe("binary_sensor.on_press");
  });

  it("mirrors a device_on location's trigger as-is (no domain prefix)", () => {
    expect(
      effectiveTriggerIdFor(
        tree(),
        { kind: "device_on", trigger: "on_boot" },
        devices,
        triggers
      )
    ).toBe("on_boot");
  });

  it("qualifies a component_on location's bare trigger key", () => {
    expect(
      effectiveTriggerIdFor(tree(), componentOn("on_turn_on"), devices, triggers)
    ).toBe("switch.on_turn_on");
  });

  it("qualifies a platform-scoped trigger from the offered triggers", () => {
    expect(
      effectiveTriggerIdFor(
        tree(),
        componentOn("on_clockwise", "dial"),
        [rotary],
        triggers
      )
    ).toBe("rotary_encoder.sensor.on_clockwise");
  });

  it("returns null when neither the tree nor the location carries one", () => {
    expect(
      effectiveTriggerIdFor(tree(), { kind: "interval", index: 0 }, devices, triggers)
    ).toBeNull();
    expect(effectiveTriggerIdFor(tree(), null, devices, triggers)).toBeNull();
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
