import { describe, expect, it } from "vitest";

import type {
  AutomationTrigger,
  AvailableComponentInstance,
} from "../../../../src/api/types/automations.js";
import {
  componentDomain,
  firstSelectableTarget,
  instanceContext,
  instanceName,
  isSelectableTarget,
  selectableTargets,
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
    repeatable: false,
    config_entries: [],
    ...over,
  }) as AutomationTrigger;

const onValueRange = trigger({ id: "sensor.on_value_range", applies_to: ["sensor"] });
const onBoot = trigger({ id: "on_boot", is_device_level: true });

describe("component-targets", () => {
  it("treats only non-containers as selectable", () => {
    expect(isSelectableTarget(temp)).toBe(true);
    expect(isSelectableTarget(relay)).toBe(true);
    expect(isSelectableTarget(container)).toBe(false);
  });

  it("drops containers from the selectable list and the first-selectable lookup", () => {
    const devices = [container, temp, relay];
    expect(selectableTargets(devices)).toEqual([temp, relay]);
    expect(firstSelectableTarget(devices)).toBe(temp);
  });

  it("matches component triggers by bare sub-domain", () => {
    expect(triggersForComponent([onValueRange, onBoot], temp)).toEqual([onValueRange]);
  });

  it("matches by the qualified domain.platform too", () => {
    expect(triggersForComponent([onValueRange], relay).length).toBe(0);
    const onTurnOn = trigger({ id: "switch.on_turn_on", applies_to: ["switch.gpio"] });
    expect(triggersForComponent([onTurnOn], relay)).toEqual([onTurnOn]);
  });

  it("offers nothing for a container or a missing device", () => {
    expect(triggersForComponent([onValueRange], container)).toEqual([]);
    expect(triggersForComponent([onValueRange], undefined)).toEqual([]);
  });
});

describe("instance label helpers", () => {
  it("instanceName falls back from name to id", () => {
    expect(instanceName(inst({ id: "x", component_id: "sensor", name: "Kit" }))).toBe(
      "Kit"
    );
    expect(instanceName(inst({ id: "x", component_id: "sensor" }))).toBe("x");
  });

  it("componentDomain takes the bare domain", () => {
    expect(componentDomain("sensor.aht10")).toBe("sensor");
    expect(componentDomain("sensor")).toBe("sensor");
  });

  it("instanceContext appends the owning container for a sub-entity", () => {
    const named = inst({ id: "aht20", component_id: "sensor.aht10", name: "AHT20" });
    const devices = [named, temp];
    // Sub-entity → domain · parent label; plain instance → bare domain only.
    expect(instanceContext(temp, devices)).toBe("sensor · AHT20");
    expect(instanceContext(relay, devices)).toBe("switch.gpio");
    // A dangling parent_id (parent absent) degrades to the bare domain.
    expect(
      instanceContext(
        inst({ id: "o", component_id: "sensor", parent_id: "gone" }),
        devices
      )
    ).toBe("sensor");
  });
});
