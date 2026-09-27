/**
 * @vitest-environment happy-dom
 *
 * The literal / lambda toggle stashes the side being left, keyed by the form
 * and the field's path. A form re-targeted to other entries (an automation
 * node whose action changed) must not restore a value typed for the
 * previous ones at a path they share. Nor must one whose values were read
 * again from a YAML edited outside it.
 */
import { ContextProvider } from "@lit/context";
import { describe, expect, it } from "vitest";

import { mountControlledForm as mountForm } from "./_config-entry-form-host.js";

import type { ConfigEntry } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { valuesReadContext } from "../../../src/context/index.js";
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

  it("forgets the stash once the owner has read the values from the YAML again", async () => {
    // The YAML may have been edited by hand (#1906): the field at this path
    // can be another one by now, and the form is not told.
    const { form, changes, toggle } = await mountForm(valueEntry("Delay"), {
      id: { _lambda: "return 1000;", _tag: "!lambda" },
    });
    await toggle("literal");

    form.valuesRead++;
    await form.updateComplete;
    await toggle("lambda");

    expect(changes[changes.length - 1].value).toEqual({ _lambda: "", _tag: "!lambda" });
  });

  it("keeps a group the user opened through a new read of the values", async () => {
    const { form, ctx } = await mountForm(valueEntry("Delay"), { id: "1s" });
    form.openNested("group");

    form.valuesRead++;
    await form.updateComplete;

    expect(ctx().nestedOpenSections.has("group")).toBe(true);
  });

  it("closes a pin's Advanced panel on a new read of the values", async () => {
    // The panel writes under the pin; on a pin that is short form by now
    // (the YAML was edited) that write would drop the GPIO.
    const { form, ctx } = await mountForm(valueEntry("Delay"), { id: "1s" });
    form.openNested("pin:pin-advanced");
    ctx().seedNestedOpen("other.pin:pin-advanced");
    expect(ctx().nestedOpenSections.has("other.pin:pin-advanced")).toBe(true);

    form.valuesRead++;
    await form.updateComplete;

    expect([...ctx().nestedOpenSections]).toEqual([]);
    // It may open on its own again, where the pin has values to show.
    ctx().seedNestedOpen("other.pin:pin-advanced");
    expect(ctx().nestedOpenSections.has("other.pin:pin-advanced")).toBe(true);
  });

  it("forgets a constraint cluster's choice and stash on a new read of the values", async () => {
    const { form, ctx } = await mountForm(valueEntry("Delay"), { id: "1s" });
    ctx().setClusterChoice("cluster", "b");
    ctx().setClusterStash("cluster", "key", "typed for the side left");

    form.valuesRead++;
    await form.updateComplete;

    expect(ctx().getClusterChoice("cluster")).toBeUndefined();
    expect(ctx().getClusterStash("cluster", "key")).toBeUndefined();
  });

  describe("under an editor that provides the count", () => {
    async function mountUnderProvider() {
      const mounted = await mountForm(valueEntry("Delay"), {
        id: { _lambda: "return 1000;", _tag: "!lambda" },
      });
      const editor = document.createElement("div");
      const provider = new ContextProvider(editor, {
        context: valuesReadContext,
        initialValue: 0,
      });
      document.body.appendChild(editor);
      editor.appendChild(mounted.form);
      await mounted.form.updateComplete;
      return { ...mounted, provider };
    }

    it("forgets the stash on a new count", async () => {
      const { form, changes, toggle, provider } = await mountUnderProvider();
      await toggle("literal");

      provider.setValue(1);
      await form.updateComplete;
      await toggle("lambda");

      expect(changes[changes.length - 1].value).toEqual({ _lambda: "", _tag: "!lambda" });
    });
  });
});
