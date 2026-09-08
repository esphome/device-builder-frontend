/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));

import { identityLocalize } from "../../../_dom.js";
import type {
  AutomationLocation,
  AutomationTrigger,
  AvailableComponentInstance,
} from "../../../../src/api/types/automations.js";
import { ESPHomeAutomationTargetPicker } from "../../../../src/components/device/automation-editor/automation-target-picker.js";

async function mount(
  devices: AvailableComponentInstance[],
  value: AutomationLocation,
  triggers: AutomationTrigger[] = []
): Promise<ESPHomeAutomationTargetPicker> {
  const el = new ESPHomeAutomationTargetPicker();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._localize = identityLocalize;
  el.devices = devices;
  el.triggers = triggers;
  el.value = value;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("automation-target-picker container options", () => {
  it("offers a container only when a trigger is scoped to its platform", async () => {
    const devices: AvailableComponentInstance[] = [
      {
        id: "ltr",
        name: "LTR501",
        component_id: "sensor.ltr501",
        is_entity_container: true,
      },
      { id: "ltr_als", name: "Ambient", component_id: "sensor", parent_id: "ltr" },
    ];
    const location: AutomationLocation = {
      kind: "component_on",
      component_id: "ltr_als",
      trigger: "",
    };
    const values = (el: ESPHomeAutomationTargetPicker) =>
      [...el.shadowRoot!.querySelectorAll("wa-option")].map((o) =>
        o.getAttribute("value")
      );
    const without = await mount(devices, location);
    expect(values(without)).not.toContain("ltr");
    const withTrigger = await mount(devices, location, [
      {
        id: "ltr501.sensor.on_ps_high_threshold",
        name: "On Ps High",
        description: "",
        docs_url: "",
        applies_to: ["sensor.ltr501"],
        is_device_level: false,
        supports_list: false,
        config_entries: [],
      },
    ]);
    expect(values(withTrigger)).toContain("ltr");
  });
});

describe("automation-target-picker sub-entity options", () => {
  it("disambiguates same-named sub-entities by their parent", async () => {
    const devices: AvailableComponentInstance[] = [
      {
        id: "aht_a",
        name: "AHT A",
        component_id: "sensor.aht10",
        is_entity_container: true,
      },
      { id: "a_temp", name: "Temperature", component_id: "sensor", parent_id: "aht_a" },
      {
        id: "aht_b",
        name: "AHT B",
        component_id: "sensor.aht10",
        is_entity_container: true,
      },
      { id: "b_temp", name: "Temperature", component_id: "sensor", parent_id: "aht_b" },
      { id: "relay", name: "Relay", component_id: "switch.gpio" },
    ];
    const el = await mount(devices, {
      kind: "component_on",
      component_id: "a_temp",
      trigger: "",
    });
    const options = [...el.shadowRoot!.querySelectorAll("wa-option")];
    const text = (id: string) =>
      options
        .find((o) => o.getAttribute("value") === id)!
        .textContent!.replace(/\s+/g, " ")
        .trim();

    // Container is not offered; the two sub-entities carry their parent.
    expect(options.some((o) => o.getAttribute("value") === "aht_a")).toBe(false);
    expect(text("a_temp")).toContain("AHT A");
    expect(text("b_temp")).toContain("AHT B");
    expect(text("a_temp")).not.toBe(text("b_temp"));
    // A plain instance keeps its bare component_id, no parent suffix.
    expect(text("relay")).toContain("switch.gpio");
    expect(text("relay")).not.toContain("·");
  });
});
