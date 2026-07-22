// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import "../../_mock-webawesome.js";

import { ESPHomeAddComponentForm } from "../../../src/components/device/add-component-form.js";

/**
 * Pins that editing a field clears its per-item error keys too (#1348):
 * a multi_value edit emits the whole array at the field path, so ``codes.0``
 * must not survive as a stale red ring.
 */
interface ErrorClearView {
  _errors: Map<string, { key: string; code: string }>;
  _onValueChange(e: CustomEvent): void;
}

const changeEvent = (path: string[], value: unknown) =>
  new CustomEvent("value-change", { detail: { path, value } });

describe("esphome-add-component-form error clearing", () => {
  it("clears per-item keys under the edited field path", () => {
    const form = new ESPHomeAddComponentForm() as unknown as ErrorClearView;
    form._errors = new Map([
      ["codes.0", { key: "codes.0", code: "validation.not_a_number" }],
      ["codes.1", { key: "codes.1", code: "validation.max" }],
      ["other", { key: "other", code: "validation.required" }],
    ]);

    form._onValueChange(changeEvent(["codes"], [3, 5]));

    expect(form._errors.has("codes.0")).toBe(false);
    expect(form._errors.has("codes.1")).toBe(false);
    expect(form._errors.has("other")).toBe(true);
  });
});
