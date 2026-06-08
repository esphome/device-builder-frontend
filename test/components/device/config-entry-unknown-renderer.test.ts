/**
 * @vitest-environment happy-dom
 *
 * An UNKNOWN config entry (a mapping-or-list union like the ntc sensor's
 * 'calibration' the backend can't model) renders the YAML-only notice
 * instead of an input, so the wizard no longer shows a broken control.
 * Issue #1328.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeConfigEntryForm } from "../../../src/components/device/config-entry-form.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";

describe("config-entry-form UNKNOWN field", () => {
  it("renders the YAML-only notice and no editable control", async () => {
    const form = new ESPHomeConfigEntryForm();
    form.entries = [
      makeConfigEntry({
        key: "calibration",
        type: ConfigEntryType.UNKNOWN,
        required: true,
      }),
    ];
    form.values = {};
    document.body.append(form);
    await form.updateComplete;

    const root = form.shadowRoot!;
    const field = root.querySelector("[data-field-key]");
    expect(field).not.toBeNull();
    // No control the user could type a value into.
    expect(root.querySelector("input, textarea, wa-select")).toBeNull();
    // The YAML-only notice is shown instead (the test localizer echoes keys).
    expect(field?.textContent).toContain("value_yaml_only");
  });
});
