/**
 * @vitest-environment happy-dom
 *
 * A ``TRIGGER`` config entry (a component action-list field such as
 * cover ``open_action``) renders an "Edit actions" button that emits
 * ``edit-action-field`` with the field's full path, so the section host
 * can route nested fields to the automation editor.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner-js", () => ({
  default: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeConfigEntryForm } from "../../../src/components/device/config-entry-form.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";

describe("config-entry-form TRIGGER field", () => {
  it("emits edit-action-field with the field path when clicked", async () => {
    const form = new ESPHomeConfigEntryForm();
    form.entries = [
      makeConfigEntry({ key: "open_action", type: ConfigEntryType.TRIGGER }),
    ];
    form.values = {};
    document.body.append(form);
    await form.updateComplete;

    let path: string[] | undefined;
    form.addEventListener("edit-action-field", (e) => {
      path = (e as CustomEvent<{ path: string[] }>).detail.path;
    });

    const button =
      form.shadowRoot?.querySelector<HTMLButtonElement>(".edit-actions-button");
    expect(button).not.toBeNull();
    button?.click();
    expect(path).toEqual(["open_action"]);
  });

  it("emits the full path for a TRIGGER nested below a group", async () => {
    const form = new ESPHomeConfigEntryForm();
    form.entries = [
      makeConfigEntry({
        key: "repeat_number",
        type: ConfigEntryType.NESTED,
        config_entries: [
          makeConfigEntry({ key: "set_action", type: ConfigEntryType.TRIGGER }),
        ],
      }),
    ];
    form.values = { repeat_number: { set_action: [] } };
    // Open the group the way the renderer tracks it (path-joined key).
    (form as unknown as { _nestedOpenSections: Set<string> })._nestedOpenSections =
      new Set(["repeat_number"]);
    document.body.append(form);
    await form.updateComplete;

    let path: string[] | undefined;
    form.addEventListener("edit-action-field", (e) => {
      path = (e as CustomEvent<{ path: string[] }>).detail.path;
    });

    const button =
      form.shadowRoot?.querySelector<HTMLButtonElement>(".edit-actions-button");
    expect(button).not.toBeNull();
    button?.click();
    expect(path).toEqual(["repeat_number", "set_action"]);
  });
});
