/**
 * @vitest-environment happy-dom
 *
 * Advanced-section wiring tests for ``automation-condition-tree.ts``
 * (issue #1905: sensor.in_range's above/below were unreachable).
 *
 * The tree keys its rows, so the per-row "Show advanced settings" flag
 * follows its row across moves and removals, and is reset by a kind change.
 * ``config-entry-form`` drags CodeMirror in transitively, so ``vi.mock``
 * no-ops it; picks are delivered by answering the tree's pick request.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/device/config-entry-form.js", () => ({}));
vi.mock(
  "../../../../src/components/device/automation-editor/catalog-picker-host.js",
  () => ({
    requestCatalogPick: (from: HTMLElement, request: unknown) =>
      from.dispatchEvent(new CustomEvent("request-catalog-pick", { detail: request })),
  })
);
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type {
  AutomationCondition,
  ConditionNode,
} from "../../../../src/api/types/automations.js";
import type { ConfigEntry } from "../../../../src/api/types/config-entries.js";
import { ESPHomeAutomationConditionTree } from "../../../../src/components/device/automation-editor/automation-condition-tree.js";

function entry(key: string, advanced: boolean): ConfigEntry {
  return {
    key,
    advanced,
    type: "string",
    label: key,
    required: false,
  } as unknown as ConfigEntry;
}

/** Mixed advanced/basic entries so the in-form advanced control renders. */
function condition(id: string): AutomationCondition {
  return {
    id,
    name: id,
    description: "",
    config_entries: [entry("id", false), entry("extra", true)],
    accepts_condition_list: false,
    required_groups: [{ kind: "at_least_one", keys: ["above", "below"] }],
  } as unknown as AutomationCondition;
}

function node(condition_id: string): ConditionNode {
  return { condition_id, params: {} };
}

const CATALOG = [condition("sensor.in_range"), condition("number.in_range")];

async function mountTree(
  conditions: ConditionNode[],
  { readOnly = false } = {}
): Promise<ESPHomeAutomationConditionTree> {
  const el = new ESPHomeAutomationConditionTree();
  el.conditions = conditions;
  el.catalog = CATALOG;
  // Mirror the owner contract: mutations come back through
  // conditions-change and the parent rebinds the list, unless it is
  // read only and drops them.
  if (!readOnly) {
    el.addEventListener("conditions-change", (e) => {
      el.conditions = (
        e as CustomEvent<{ conditions: ConditionNode[] }>
      ).detail.conditions;
    });
  }
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function forms(el: ESPHomeAutomationConditionTree): Element[] {
  return [...el.shadowRoot!.querySelectorAll("esphome-config-entry-form")];
}

function toggleAdvanced(form: Element, show: boolean): void {
  form.dispatchEvent(
    new CustomEvent("advanced-toggle", {
      detail: { show },
      bubbles: true,
      composed: true,
    })
  );
}

describe("automation-condition-tree advanced section", () => {
  it("opts every row's form into the advanced section", async () => {
    const el = await mountTree([node("sensor.in_range"), node("number.in_range")]);
    for (const form of forms(el)) {
      expect(form.hasAttribute("advanced-section")).toBe(true);
      expect(form.hasAttribute("show-advanced")).toBe(false);
    }
  });

  it("forwards the definition's required_groups to the form", async () => {
    const el = await mountTree([node("sensor.in_range")]);
    const form = forms(el)[0] as Element & { requiredGroups?: unknown };
    expect(form.requiredGroups).toEqual([
      { kind: "at_least_one", keys: ["above", "below"] },
    ]);
  });

  it("tracks the advanced toggle per row", async () => {
    const el = await mountTree([node("sensor.in_range"), node("number.in_range")]);

    toggleAdvanced(forms(el)[1], true);
    await el.updateComplete;

    expect(forms(el)[0].hasAttribute("show-advanced")).toBe(false);
    expect(forms(el)[1].hasAttribute("show-advanced")).toBe(true);

    toggleAdvanced(forms(el)[1], false);
    await el.updateComplete;
    expect(forms(el)[1].hasAttribute("show-advanced")).toBe(false);
  });

  it("shifts the flag down when an earlier row is removed", async () => {
    const el = await mountTree([node("sensor.in_range"), node("number.in_range")]);

    toggleAdvanced(forms(el)[1], true);
    await el.updateComplete;

    el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".ae-row-delete")[0].click();
    await el.updateComplete;

    expect(forms(el)).toHaveLength(1);
    expect(forms(el)[0].hasAttribute("show-advanced")).toBe(true);
  });

  it("puts focus back on the move button once its row has moved", async () => {
    const el = await mountTree([
      node("sensor.in_range"),
      node("number.in_range"),
      node("sensor.in_range"),
    ]);
    const button = el.shadowRoot!.querySelector<HTMLButtonElement>(
      '.ae-row button[aria-label="device.automation_move_down"]'
    )!;
    button.focus();
    const focus = vi.spyOn(button, "focus");

    button.click();
    await el.updateComplete;

    expect(el.shadowRoot!.activeElement).toBe(button);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("acts on the moved row, not on the one that took its place", async () => {
    const el = await mountTree([
      node("sensor.in_range"),
      node("number.in_range"),
      node("binary_sensor.is_on"),
    ]);
    const row = el.shadowRoot!.querySelector(".ae-row")!;
    const button = (label: string) =>
      row.querySelector<HTMLButtonElement>(
        `button[aria-label="device.automation_${label}"]`
      )!;

    button("move_down").click();
    await el.updateComplete;
    button("remove").click();
    await el.updateComplete;

    expect(el.conditions.map((c) => c.condition_id)).toEqual([
      "number.in_range",
      "binary_sensor.is_on",
    ]);
  });

  it("does not hand the caret's target to a row moved onto its index", async () => {
    const el = await mountTree([
      node("sensor.in_range"),
      node("number.in_range"),
      node("sensor.in_range"),
    ]);
    el.focusTarget = { node: [1], field: ["basic"] };
    await el.updateComplete;
    const fieldFocus = () =>
      forms(el).map(
        (form) => (form as unknown as { focusFieldPath?: string[] }).focusFieldPath
      );
    expect(fieldFocus()).toEqual([undefined, ["basic"], undefined]);

    el.shadowRoot!.querySelector<HTMLButtonElement>(
      '.ae-row button[aria-label="device.automation_move_down"]'
    )!.click();
    await el.updateComplete;

    expect(fieldFocus()).toEqual([undefined, undefined, undefined]);
  });

  it("moves the flag with its row on a reorder", async () => {
    const el = await mountTree([node("sensor.in_range"), node("number.in_range")]);
    const opened = forms(el)[0];

    toggleAdvanced(opened, true);
    await el.updateComplete;
    el.shadowRoot!.querySelector<HTMLButtonElement>(
      '.ae-row button[aria-label="device.automation_move_down"]'
    )!.click();
    await el.updateComplete;

    expect(el.conditions.map((c) => c.condition_id)).toEqual([
      "number.in_range",
      "sensor.in_range",
    ]);
    expect(forms(el)[0].hasAttribute("show-advanced")).toBe(false);
    expect(forms(el)[1].hasAttribute("show-advanced")).toBe(true);
    // The row's own form moved with it, carrying whatever it remembers.
    expect(forms(el)[1]).toBe(opened);
  });

  it("leaves the flags alone when the parent drops a delete", async () => {
    const el = await mountTree([node("sensor.in_range"), node("number.in_range")], {
      readOnly: true,
    });

    toggleAdvanced(forms(el)[1], true);
    await el.updateComplete;
    el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".ae-row-delete")[0].click();
    await el.updateComplete;

    expect(forms(el)).toHaveLength(2);
    expect(forms(el)[0].hasAttribute("show-advanced")).toBe(false);
    expect(forms(el)[1].hasAttribute("show-advanced")).toBe(true);
  });

  it("resets the flag when the row's condition kind changes", async () => {
    const el = await mountTree([node("sensor.in_range")]);

    toggleAdvanced(forms(el)[0], true);
    await el.updateComplete;
    expect(forms(el)[0].hasAttribute("show-advanced")).toBe(true);

    // Change the row's kind through the picker flow: answer the pick request.
    const requests: { onPicked(detail: { id: string }): void }[] = [];
    el.addEventListener("request-catalog-pick", (e) =>
      requests.push((e as CustomEvent).detail)
    );
    el.shadowRoot!.querySelector<HTMLButtonElement>(".ae-row-picker")!.click();
    expect(requests).toHaveLength(1);
    requests[0].onPicked({ id: "number.in_range" });
    await el.updateComplete;

    expect(forms(el)[0].hasAttribute("show-advanced")).toBe(false);
  });

  it("keeps the flag with its condition when the list is read again with a row above", async () => {
    const el = await mountTree([node("sensor.in_range"), node("number.in_range")]);
    const opened = forms(el)[1];
    toggleAdvanced(opened, true);
    await el.updateComplete;

    // Every node a new object, as after a parse of the YAML.
    el.conditions = [
      { condition_id: "sensor.in_range", params: { above: 5 } },
      node("sensor.in_range"),
      node("number.in_range"),
    ];
    await el.updateComplete;

    expect(forms(el).map((form) => form.hasAttribute("show-advanced"))).toEqual([
      false,
      false,
      true,
    ]);
    expect(forms(el)[2]).toBe(opened);
  });
});
