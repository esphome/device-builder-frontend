import { describe, expect, it } from "vitest";

import type {
  AutomationLocation,
  AutomationTrigger,
} from "../../src/api/types/automations.js";
import type { ComponentCatalogEntry } from "../../src/api/types/components.js";
import { triggerParamFormEntries } from "../../src/util/trigger-param-form-entries.js";
import { makeConfigEntry } from "./_make-config-entry.js";

const trigger = (...keys: string[]): AutomationTrigger =>
  ({
    config_entries: keys.map((key) => makeConfigEntry({ key })),
  }) as AutomationTrigger;

const component = (...keys: string[]): ComponentCatalogEntry =>
  ({
    config_entries: keys.map((key) => makeConfigEntry({ key })),
  }) as ComponentCatalogEntry;

const keys = (entries: { key: string }[]) => entries.map((e) => e.key);

describe("triggerParamFormEntries", () => {
  it("returns the active trigger's own config_entries for non-interval kinds", () => {
    const loc: AutomationLocation = { kind: "device_on", trigger: "on_boot" };
    const result = triggerParamFormEntries(
      loc,
      null,
      trigger("min_length", "max_length")
    );
    expect(keys(result)).toEqual(["min_length", "max_length"]);
  });

  it("ignores the interval component when the location isn't interval", () => {
    const loc: AutomationLocation = { kind: "device_on", trigger: "on_boot" };
    const result = triggerParamFormEntries(
      loc,
      component("interval", "then"),
      trigger("delay")
    );
    expect(keys(result)).toEqual(["delay"]);
  });

  it("pulls from the interval component schema, minus the then block", () => {
    const loc: AutomationLocation = { kind: "interval", index: 0 };
    const result = triggerParamFormEntries(
      loc,
      component("interval", "then"),
      trigger("ignored")
    );
    expect(keys(result)).toEqual(["interval"]);
  });

  it("returns nothing for interval when the component isn't resolved yet", () => {
    const loc: AutomationLocation = { kind: "interval", index: 0 };
    expect(triggerParamFormEntries(loc, null, trigger("ignored"))).toEqual([]);
  });

  it("returns an empty list when there is neither a component nor a trigger", () => {
    expect(triggerParamFormEntries(null, null, null)).toEqual([]);
    const loc: AutomationLocation = { kind: "script", id: "blink" };
    expect(triggerParamFormEntries(loc, null, null)).toEqual([]);
  });
});
