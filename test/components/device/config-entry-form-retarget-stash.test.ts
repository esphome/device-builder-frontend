/**
 * @vitest-environment happy-dom
 *
 * The literal / lambda toggle stashes the side being left, keyed by the form
 * and the field's path. A form re-targeted to other entries (an automation
 * node whose action changed) must not restore a value typed for the
 * previous ones at a path they share.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/switch/switch.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/tooltip/tooltip.js", () => ({}));
vi.mock(
  "../../../src/components/device/config-entry-renderers/lambda-editor.js",
  () => ({})
);

import type { ConfigEntry } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import {
  type ConfigEntryValueChange,
  ESPHomeConfigEntryForm,
} from "../../../src/components/device/config-entry-form.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

const valueEntry = (label: string): ConfigEntry[] => [
  makeConfigEntry({ key: "id", type: ConfigEntryType.STRING, label, templatable: true }),
];

async function mountForm(entries: ConfigEntry[], values: Record<string, unknown>) {
  const form = new ESPHomeConfigEntryForm();
  form.entries = entries;
  form.values = values;
  const changes: ConfigEntryValueChange[] = [];
  // The form is controlled: the owner applies each change to ``values``.
  form.addEventListener("value-change", (e) => {
    const change = (e as CustomEvent<ConfigEntryValueChange>).detail;
    changes.push(change);
    form.values = { ...form.values, [change.path[0]]: change.value };
  });
  document.body.appendChild(form);
  await form.updateComplete;
  const toggle = async (side: "literal" | "lambda") => {
    const buttons = form.shadowRoot!.querySelectorAll<HTMLButtonElement>(
      ".templatable-toggle button"
    );
    buttons[side === "literal" ? 0 : 1].click();
    await form.updateComplete;
  };
  return { form, changes, toggle };
}

describe("config-entry-form literal / lambda stash", () => {
  it("restores the stashed lambda on the same entries", async () => {
    const { changes, toggle } = await mountForm(valueEntry("Delay"), {
      id: { _lambda: "return 1000;", _tag: "!lambda" },
    });
    await toggle("literal");
    await toggle("lambda");
    expect(changes[changes.length - 1].value).toEqual({
      _lambda: "return 1000;",
      _tag: "!lambda",
    });
  });

  it("keeps the stash when the host rebuilds its list of the same entries", async () => {
    // A host that filters the catalog's entries on every render hands over
    // a new array of the same objects; that is the same form, not a re-target.
    const entries = valueEntry("Delay");
    const { form, changes, toggle } = await mountForm(entries, {
      id: { _lambda: "return 1000;", _tag: "!lambda" },
    });
    await toggle("literal");

    form.entries = entries.filter(Boolean);
    await form.updateComplete;
    await toggle("lambda");

    expect(changes[changes.length - 1].value).toEqual({
      _lambda: "return 1000;",
      _tag: "!lambda",
    });
  });

  it("forgets the stash once the form is re-targeted, even to like-named fields", async () => {
    const { form, changes, toggle } = await mountForm(valueEntry("Delay"), {
      id: { _lambda: "return 1000;", _tag: "!lambda" },
    });
    await toggle("literal");

    // Another definition whose one field has the same key and type.
    form.entries = valueEntry("Other action");
    form.values = {};
    await form.updateComplete;
    await toggle("lambda");

    expect(changes[changes.length - 1].value).toEqual({ _lambda: "", _tag: "!lambda" });
  });
});
