/**
 * @vitest-environment happy-dom
 *
 * Advanced-section wiring tests for ``automation-trigger-picker.ts``
 * (issue #1905: advanced trigger params were unreachable).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/device/config-entry-form.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));

import type { AutomationTrigger } from "../../../../src/api/types/automations.js";
import type { ConfigEntry } from "../../../../src/api/types/config-entries.js";
import { ESPHomeAutomationTriggerPicker } from "../../../../src/components/device/automation-editor/automation-trigger-picker.js";

function entry(key: string, advanced: boolean): ConfigEntry {
  return {
    key,
    advanced,
    type: "string",
    label: key,
    required: false,
  } as unknown as ConfigEntry;
}

function trigger(id: string): AutomationTrigger {
  return {
    id,
    name: id,
    description: "",
    docs_url: "",
    applies_to: [],
    is_device_level: true,
    supports_list: false,
    config_entries: [entry("plain", false), entry("secret", true)],
  } as unknown as AutomationTrigger;
}

const TRIGGERS = [trigger("esphome.on_boot"), trigger("esphome.on_shutdown")];

async function mountPicker(triggerId: string): Promise<ESPHomeAutomationTriggerPicker> {
  const el = new ESPHomeAutomationTriggerPicker();
  el.target = { kind: "device_on", trigger: triggerId };
  el.triggers = TRIGGERS;
  el.triggerId = triggerId;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function paramsForm(el: ESPHomeAutomationTriggerPicker): Element {
  return el.shadowRoot!.querySelector("esphome-config-entry-form")!;
}

describe("automation-trigger-picker advanced section", () => {
  it("opts the params form into the advanced section", async () => {
    const el = await mountPicker("esphome.on_boot");
    expect(paramsForm(el).hasAttribute("advanced-section")).toBe(true);
    expect(paramsForm(el).hasAttribute("show-advanced")).toBe(false);
  });

  it("tracks the advanced toggle and resets on trigger change", async () => {
    const el = await mountPicker("esphome.on_boot");

    paramsForm(el).dispatchEvent(
      new CustomEvent("advanced-toggle", {
        detail: { show: true },
        bubbles: true,
        composed: true,
      })
    );
    await el.updateComplete;
    expect(paramsForm(el).hasAttribute("show-advanced")).toBe(true);

    el.triggerId = "esphome.on_shutdown";
    await el.updateComplete;
    expect(paramsForm(el).hasAttribute("show-advanced")).toBe(false);
  });
});
