import { describe, expect, it } from "vitest";

import type {
  AutomationTrigger,
  AvailableComponentInstance,
} from "../../../../src/api/types/automations.js";
import {
  componentDomain,
  firstTriggerTarget,
  instanceContext,
  instanceName,
  isActionTarget,
  isTriggerTarget,
  preFillIdParam,
  triggersForComponent,
} from "../../../../src/components/device/automation-editor/component-targets.js";

const inst = (
  over: Partial<AvailableComponentInstance> & { id: string; component_id: string }
): AvailableComponentInstance => over;

const container = inst({
  id: "aht20",
  component_id: "sensor.aht10",
  is_entity_container: true,
});
const temp = inst({
  id: "aht20_temperature",
  component_id: "sensor",
  parent_id: "aht20",
});
const relay = inst({ id: "relay", component_id: "switch.gpio" });

const trigger = (over: Partial<AutomationTrigger> & { id: string }): AutomationTrigger =>
  ({
    name: over.id,
    applies_to: [],
    is_device_level: false,
    supports_list: false,
    config_entries: [],
    ...over,
  }) as AutomationTrigger;

const onValueRange = trigger({ id: "sensor.on_value_range", applies_to: ["sensor"] });
const onBoot = trigger({ id: "on_boot", is_device_level: true });
const ltr = inst({ id: "ltr", component_id: "sensor.ltr501", is_entity_container: true });
const onPsHigh = trigger({
  id: "ltr501.sensor.on_ps_high_threshold",
  applies_to: ["sensor.ltr501"],
});

describe("component-targets", () => {
  it("treats non-containers as selectable and containers only with their own triggers", () => {
    expect(isTriggerTarget(temp, [onValueRange])).toBe(true);
    expect(isTriggerTarget(relay, [])).toBe(true);
    expect(isTriggerTarget(container, [onValueRange])).toBe(false);
    expect(isTriggerTarget(ltr, [onValueRange])).toBe(false);
    expect(isTriggerTarget(ltr, [onValueRange, onPsHigh])).toBe(true);
  });

  it("drops trigger-less containers from the selectable list and the first-selectable lookup", () => {
    const devices = [container, temp, relay];
    const hosting = (d: AvailableComponentInstance) => isTriggerTarget(d, [onValueRange]);
    expect(devices.filter(hosting)).toEqual([temp, relay]);
    expect(firstTriggerTarget(devices, [onValueRange])).toBe(temp);
    expect(
      [ltr, temp].filter((d) => isTriggerTarget(d, [onValueRange, onPsHigh]))
    ).toEqual([ltr, temp]);
    expect([ltr, temp].filter(isActionTarget)).toEqual([temp]);
  });

  it("offers a container only the triggers scoped to its platform", () => {
    expect(triggersForComponent([onValueRange, onPsHigh], ltr)).toEqual([onPsHigh]);
  });

  it("matches component triggers by bare sub-domain", () => {
    expect(triggersForComponent([onValueRange, onBoot], temp)).toEqual([onValueRange]);
  });

  it("matches by the qualified domain.platform too", () => {
    expect(triggersForComponent([onValueRange], relay).length).toBe(0);
    const onTurnOn = trigger({ id: "switch.on_turn_on", applies_to: ["switch.gpio"] });
    expect(triggersForComponent([onTurnOn], relay)).toEqual([onTurnOn]);
  });

  it("offers nothing for a trigger-less container or a missing device", () => {
    expect(triggersForComponent([onValueRange], container)).toEqual([]);
    expect(triggersForComponent([onValueRange], undefined)).toEqual([]);
  });
});

describe("instance label helpers", () => {
  it("instanceName falls back name → catalog title → id", () => {
    // A user name always wins.
    expect(instanceName(inst({ id: "x", component_id: "sensor", name: "Kit" }))).toBe(
      "Kit"
    );
    // No name → the catalog title, with the core suffix trimmed like the navigator.
    expect(
      instanceName(inst({ id: "wifi", component_id: "wifi", title: "WiFi Component" }))
    ).toBe("WiFi");
    expect(
      instanceName(
        inst({ id: "api", component_id: "api", title: "Native API Component" })
      )
    ).toBe("Native API");
    // A non-core title keeps its " Component" tail (e.g. a nameless copy sensor).
    expect(
      instanceName(
        inst({ id: "s", component_id: "binary_sensor.copy", title: "Copy Component" })
      )
    ).toBe("Copy Component");
    // No name and no title → the raw id.
    expect(instanceName(inst({ id: "x", component_id: "sensor" }))).toBe("x");
  });

  it("componentDomain takes the bare domain", () => {
    expect(componentDomain("sensor.aht10")).toBe("sensor");
    expect(componentDomain("sensor")).toBe("sensor");
  });

  it("instanceContext resolves a sub-entity's container even when a picker drops it", () => {
    const named = inst({
      id: "aht20",
      component_id: "sensor.aht10",
      name: "AHT20",
      is_entity_container: true,
    });
    const context = instanceContext([named, temp, relay]);
    // Sub-entity → component id · parent label; plain instance → component id only.
    expect(context(temp)).toBe("sensor · AHT20");
    expect(context(relay)).toBe("switch.gpio");
    // A dangling parent_id (parent absent) degrades to the component id.
    expect(context(inst({ id: "o", component_id: "sensor", parent_id: "gone" }))).toBe(
      "sensor"
    );
  });
});

describe("preFillIdParam", () => {
  const logAction = {
    config_entries: [
      { key: "format", type: "string", required: true },
      { key: "logger_id", type: "id", references_component: "logger" },
    ] as never,
  };

  it("pre-fills the id-shaped entry from a device with a declared id", () => {
    const device = inst({
      id: "mylogger",
      component_id: "logger",
      has_explicit_id: true,
    });
    expect(preFillIdParam(logAction, device)).toEqual({ logger_id: "mylogger" });
  });

  it("never pre-fills a synthesized id (#2208)", () => {
    // `logger` here is the backend's round-trip identity for an id-less
    // singleton, not a YAML id — pre-filling it dangles.
    expect(
      preFillIdParam(logAction, inst({ id: "logger", component_id: "logger" }))
    ).toBeUndefined();
    expect(
      preFillIdParam(
        logAction,
        inst({ id: "logger", component_id: "logger", has_explicit_id: false })
      )
    ).toBeUndefined();
  });

  it("returns undefined when the item has no entry referencing the domain", () => {
    const device = inst({
      id: "relay",
      component_id: "switch.gpio",
      has_explicit_id: true,
    });
    expect(preFillIdParam(logAction, device)).toBeUndefined();
  });
});
