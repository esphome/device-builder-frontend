// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import "../../_mock-webawesome.js";

import type { ComponentCatalogEntry } from "../../../src/api/types/components.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeAddComponentForm } from "../../../src/components/device/add-component-form.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

/**
 * Pins #1528: a wrong *typed* value flags as soon as it lands in the
 * values dict, while required-empty stays a submit-only signal.
 */
interface LiveValidationView {
  component: ComponentCatalogEntry;
  _errors: Map<string, { key: string; code: string }>;
  _onValueChange(e: CustomEvent): void;
}

const changeEvent = (path: string[], value: unknown) =>
  new CustomEvent("value-change", { detail: { path, value } });

function makeForm(): LiveValidationView {
  const form = new ESPHomeAddComponentForm() as unknown as LiveValidationView;
  form.component = {
    id: "canbus.esp32_can",
    name: "ESP32 CAN",
    config_entries: [
      makeConfigEntry({
        key: "can_id",
        type: ConfigEntryType.INTEGER,
        required: true,
        range: [0, 536870911],
      }),
      makeConfigEntry({ key: "bit_rate", type: ConfigEntryType.STRING, required: true }),
    ],
  } as unknown as ComponentCatalogEntry;
  return form;
}

describe("esphome-add-component-form live validation", () => {
  it("flags an out-of-range typed value before any submit", () => {
    const form = makeForm();
    form._onValueChange(changeEvent(["can_id"], 4434343434343434));
    expect(form._errors.get("can_id")?.code).toBe("validation.max");
  });

  it("clears the flag once the value is corrected", () => {
    const form = makeForm();
    form._onValueChange(changeEvent(["can_id"], 4434343434343434));
    form._onValueChange(changeEvent(["can_id"], 42));
    expect(form._errors.has("can_id")).toBe(false);
  });

  it("does not nag a required field emptied mid-form", () => {
    const form = makeForm();
    form._onValueChange(changeEvent(["can_id"], ""));
    expect(form._errors.size).toBe(0);
  });

  it("keeps an unrelated submit-time error while editing elsewhere", () => {
    const form = makeForm();
    form._errors = new Map([
      ["bit_rate", { key: "bit_rate", code: "validation.required" }],
    ]);
    form._onValueChange(changeEvent(["can_id"], 4434343434343434));
    expect(form._errors.get("bit_rate")?.code).toBe("validation.required");
    expect(form._errors.get("can_id")?.code).toBe("validation.max");
  });
});
