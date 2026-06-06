/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));

import type {
  AutomationLocation,
  AvailableComponentInstance,
} from "../../../../src/api/types/automations.js";
import { ESPHomeAutomationTargetPicker } from "../../../../src/components/device/automation-editor/automation-target-picker.js";

async function mount(
  devices: AvailableComponentInstance[],
  value: AutomationLocation
): Promise<ESPHomeAutomationTargetPicker> {
  const el = new ESPHomeAutomationTargetPicker();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._localize = (key: string) => key;
  el.devices = devices;
  el.value = value;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("automation-target-picker sub-entity options", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

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
