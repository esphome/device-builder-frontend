// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flags an out-of-range typed value once typing pauses, before any submit", () => {
    const form = makeForm();
    form._onValueChange(changeEvent(["can_id"], 4434343434343434));
    // Nothing mid-typing — the renderers emit partial text per keystroke.
    expect(form._errors.size).toBe(0);
    vi.advanceTimersByTime(250);
    expect(form._errors.get("can_id")?.code).toBe("validation.max");
  });

  it("never flashes an error for a partial value overwritten within the pause", () => {
    const form = makeForm();
    // A hex field's keystroke sequence: "0x" (unparseable) then the
    // complete value — only the settled value is ever validated.
    form._onValueChange(changeEvent(["can_id"], "0x"));
    form._onValueChange(changeEvent(["can_id"], 42));
    vi.advanceTimersByTime(250);
    expect(form._errors.size).toBe(0);
  });

  it("clears the flag the instant the value is corrected", () => {
    const form = makeForm();
    form._onValueChange(changeEvent(["can_id"], 4434343434343434));
    vi.advanceTimersByTime(250);
    form._onValueChange(changeEvent(["can_id"], 42));
    // No pause needed — correction is synchronous.
    expect(form._errors.has("can_id")).toBe(false);
  });

  it("keeps a shown error painted while the value is still wrong", () => {
    const form = makeForm();
    form._onValueChange(changeEvent(["can_id"], 4434343434343434));
    vi.advanceTimersByTime(250);
    // Another wrong keystroke must not blink the error away — the
    // painted key refreshes in place, immediately.
    form._onValueChange(changeEvent(["can_id"], -1));
    expect(form._errors.get("can_id")?.code).toBe("validation.min");
    vi.advanceTimersByTime(250);
    expect(form._errors.get("can_id")?.code).toBe("validation.min");
  });

  it("never strands a stale message when a later edit cancels the timer", () => {
    // A submit-set required error, an invalid replacement, then an edit
    // elsewhere inside the pause: the field must not keep saying
    // "required" while visibly holding text.
    const form = makeForm();
    form._errors = new Map([["can_id", { key: "can_id", code: "validation.required" }]]);
    form._onValueChange(changeEvent(["can_id"], 4434343434343434));
    form._onValueChange(changeEvent(["bit_rate"], "125kbps"));
    expect(form._errors.get("can_id")?.code).toBe("validation.max");
  });

  it("does not nag a required field emptied mid-form", () => {
    const form = makeForm();
    form._onValueChange(changeEvent(["can_id"], ""));
    vi.advanceTimersByTime(250);
    expect(form._errors.size).toBe(0);
  });

  it("keeps an unrelated submit-time error while editing elsewhere", () => {
    const form = makeForm();
    form._errors = new Map([
      ["bit_rate", { key: "bit_rate", code: "validation.required" }],
    ]);
    form._onValueChange(changeEvent(["can_id"], 4434343434343434));
    vi.advanceTimersByTime(250);
    expect(form._errors.get("bit_rate")?.code).toBe("validation.required");
    expect(form._errors.get("can_id")?.code).toBe("validation.max");
  });

  it("labels an error key with an index mid-path from its leaf entry", () => {
    // The old walker stopped at the list container; resolving through
    // the index segment reaches the leaf's own label.
    const form = makeForm() as unknown as {
      component: unknown;
      _labelForErrorKey(key: string): string;
    };
    form.component = {
      id: "servo",
      name: "Servo",
      config_entries: [
        makeConfigEntry({
          key: "servos",
          label: "Servos",
          type: ConfigEntryType.NESTED,
          multi_value: true,
          config_entries: [
            makeConfigEntry({ key: "pin", label: "Pin", type: ConfigEntryType.INTEGER }),
          ],
        }),
      ],
    };
    expect(form._labelForErrorKey("servos.0.pin")).toBe("Pin");
  });
});
