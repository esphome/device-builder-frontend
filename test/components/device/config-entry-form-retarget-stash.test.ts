/**
 * @vitest-environment happy-dom
 *
 * The literal / lambda toggle stashes the side being left, keyed by the form
 * and the field's path. A form re-targeted to other entries (an automation
 * node whose action changed) must not restore a value typed for the
 * previous ones at a path they share.
 */
import { describe, expect, it } from "vitest";

import { mountControlledForm as mountForm } from "./_config-entry-form-host.js";

import type { ConfigEntry } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

const valueEntry = (label: string): ConfigEntry[] => [
  makeConfigEntry({ key: "id", type: ConfigEntryType.STRING, label, templatable: true }),
];

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
