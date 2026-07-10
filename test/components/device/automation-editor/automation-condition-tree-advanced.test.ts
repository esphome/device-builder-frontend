/**
 * @vitest-environment happy-dom
 *
 * Advanced-section wiring tests for ``automation-condition-tree.ts``
 * (issue #1905: sensor.in_range's above/below were unreachable).
 *
 * The tree renders rows with a plain ``conditions.map(...)`` (no keyed
 * ``repeat()``), so the per-row "Show advanced settings" flag is keyed
 * by index and must follow its row across kind changes and removals.
 * ``config-entry-form`` drags CodeMirror in transitively, so ``vi.mock``
 * no-ops it; the picker dialog gets a stub element with an ``open()``.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/device/config-entry-form.js", () => ({}));
vi.mock(
  "../../../../src/components/device/automation-editor/catalog-picker-dialog.js",
  () => ({})
);
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type {
  AutomationCondition,
  ConditionNode,
} from "../../../../src/api/types/automations.js";
import type { ConfigEntry } from "../../../../src/api/types/config-entries.js";
import { ESPHomeAutomationConditionTree } from "../../../../src/components/device/automation-editor/automation-condition-tree.js";

if (!customElements.get("esphome-catalog-picker-dialog")) {
  customElements.define(
    "esphome-catalog-picker-dialog",
    class extends HTMLElement {
      open() {}
    }
  );
}

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
  conditions: ConditionNode[]
): Promise<ESPHomeAutomationConditionTree> {
  const el = new ESPHomeAutomationConditionTree();
  el.conditions = conditions;
  el.catalog = CATALOG;
  // Mirror the owner contract: mutations come back through
  // conditions-change and the parent rebinds the list.
  el.addEventListener("conditions-change", (e) => {
    el.conditions = (e as CustomEvent<{ conditions: ConditionNode[] }>).detail.conditions;
  });
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

  it("resets the flag when the row's condition kind changes", async () => {
    const el = await mountTree([node("sensor.in_range")]);

    toggleAdvanced(forms(el)[0], true);
    await el.updateComplete;
    expect(forms(el)[0].hasAttribute("show-advanced")).toBe(true);

    // Change the row's kind through the picker flow.
    el.shadowRoot!.querySelector<HTMLButtonElement>(".ae-row-picker")!.click();
    el.shadowRoot!.querySelector("esphome-catalog-picker-dialog")!.dispatchEvent(
      new CustomEvent("catalog-picked", { detail: { id: "number.in_range" } })
    );
    await el.updateComplete;

    expect(forms(el)[0].hasAttribute("show-advanced")).toBe(false);
  });
});
