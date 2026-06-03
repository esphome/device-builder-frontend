/**
 * @vitest-environment happy-dom
 *
 * A ``TRIGGER`` config entry (a component action-list field such as
 * cover ``open_action``) renders an "Edit actions" button that emits
 * ``edit-action-field`` with the field key, so the section host can
 * route it to the automation editor.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeConfigEntryForm } from "../../../src/components/device/config-entry-form.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";

describe("config-entry-form TRIGGER field", () => {
  it("emits edit-action-field with the field key when clicked", async () => {
    const form = new ESPHomeConfigEntryForm();
    form.entries = [
      makeConfigEntry({ key: "open_action", type: ConfigEntryType.TRIGGER }),
    ];
    form.values = {};
    document.body.append(form);
    await form.updateComplete;

    let field: string | undefined;
    form.addEventListener("edit-action-field", (e) => {
      field = (e as CustomEvent<{ field: string }>).detail.field;
    });

    const button =
      form.shadowRoot?.querySelector<HTMLButtonElement>(".edit-actions-button");
    expect(button).not.toBeNull();
    button?.click();
    expect(field).toBe("open_action");
  });
});
