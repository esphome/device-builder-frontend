/**
 * @vitest-environment happy-dom
 *
 * What the form remembers for a list row is keyed by a path that holds the
 * row's index (esphome/device-builder-frontend#1886). Removing a row moves
 * the rows below it up, and what was remembered for them has to follow.
 */
import { describe, expect, it } from "vitest";

import { mountControlledForm } from "./_config-entry-form-host.js";

import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

const STEPS = makeConfigEntry({
  key: "steps",
  type: ConfigEntryType.NESTED,
  multi_value: true,
  config_entries: [
    makeConfigEntry({ key: "value", type: ConfigEntryType.STRING, templatable: true }),
  ],
});

const lambda = (body: string) => ({ _lambda: body, _tag: "!lambda" });

async function mountForm(steps: Record<string, unknown>[]) {
  const { form, toggle: toggleIn } = await mountControlledForm([STEPS], { steps });
  const rows = () => [
    ...form.shadowRoot!.querySelectorAll<HTMLElement>(".nested-list-item"),
  ];
  const toggle = (row: number, side: "literal" | "lambda") => toggleIn(side, rows()[row]);
  const remove = async (row: number) => {
    rows()
      [row].querySelector<HTMLButtonElement>(".nested-list-item-header button")!
      .click();
    await form.updateComplete;
  };
  const values = () => (form.values.steps as { value: unknown }[]).map((s) => s.value);
  return { toggle, remove, values };
}

describe("config-entry-form list rows", () => {
  it("does not restore a removed row's lambda into the row that took its place", async () => {
    const { toggle, remove, values } = await mountForm([
      { value: lambda("return 1111;") },
      { value: "two" },
    ]);

    await toggle(0, "literal");
    await remove(0);
    await toggle(0, "lambda");

    expect(values()).toEqual([lambda("")]);
  });

  it("keeps what a row remembers when the row above it is removed", async () => {
    const { toggle, remove, values } = await mountForm([
      { value: "one" },
      { value: lambda("return 2222;") },
    ]);

    await toggle(1, "literal");
    await remove(0);
    await toggle(0, "lambda");

    expect(values()).toEqual([lambda("return 2222;")]);
  });

  it("keeps an opened option list with its row", async () => {
    const { form } = await mountControlledForm([STEPS], { steps: [{}, {}, {}] });
    const ctx = () => (form as unknown as { _buildCtx(): RenderCtx })._buildCtx();

    ctx().expandOptions(["steps", "2", "value"]);
    ctx().rowRemoved(["steps"], 0);

    expect(ctx().isOptionsExpanded(["steps", "1", "value"])).toBe(true);
    expect(ctx().isOptionsExpanded(["steps", "2", "value"])).toBe(false);
  });
});
