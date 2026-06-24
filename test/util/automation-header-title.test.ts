import { describe, expect, it } from "vitest";

import type {
  AutomationLocation,
  AutomationTrigger,
} from "../../src/api/types/automations.js";
import type { LocalizeFunc } from "../../src/common/localize.js";
import { automationHeaderTitle } from "../../src/util/automation-header-title.js";

// Echo the key back, except the action-field template which interpolates
// ``{name}`` — so the component_action branch's derived label is pinned.
const localize: LocalizeFunc = (key, values) =>
  key === "device.action_field_label" ? `${values?.name} action` : key;

const trigger = (name: string): AutomationTrigger => ({ name }) as AutomationTrigger;

describe("automationHeaderTitle", () => {
  it("returns the static interval label for interval locations", () => {
    const loc: AutomationLocation = { kind: "interval", index: 0 };
    expect(automationHeaderTitle(loc, null, localize)).toBe(
      "device.automation_interval_label"
    );
  });

  it("uses the trigger name for device_on / component_on with a trigger", () => {
    const deviceOn: AutomationLocation = { kind: "device_on", trigger: "on_boot" };
    const componentOn: AutomationLocation = {
      kind: "component_on",
      component_id: "sw1",
      trigger: "on_turn_on",
    };
    expect(automationHeaderTitle(deviceOn, trigger("On Boot"), localize)).toBe("On Boot");
    expect(automationHeaderTitle(componentOn, trigger("On Turn On"), localize)).toBe(
      "On Turn On"
    );
  });

  it("falls back to the static title when the trigger isn't resolved yet", () => {
    const loc: AutomationLocation = { kind: "device_on", trigger: "on_boot" };
    expect(automationHeaderTitle(loc, null, localize)).toBe(
      "device.automation_header_title_static"
    );
  });

  it("derives the action-field label for component_action locations", () => {
    const loc: AutomationLocation = {
      kind: "component_action",
      component_id: "cover1",
      field: "open_action",
    };
    expect(automationHeaderTitle(loc, null, localize)).toBe("Open action");
  });

  it("uses the static title for other location kinds and a null location", () => {
    const script: AutomationLocation = { kind: "script", id: "blink" };
    expect(automationHeaderTitle(script, trigger("ignored"), localize)).toBe(
      "device.automation_header_title_static"
    );
    expect(automationHeaderTitle(null, null, localize)).toBe(
      "device.automation_header_title_static"
    );
  });
});
