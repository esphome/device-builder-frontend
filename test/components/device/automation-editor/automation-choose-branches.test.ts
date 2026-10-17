/**
 * @vitest-environment happy-dom
 *
 * The choose branch editor: one If tree and one Then list per branch,
 * add / remove / reorder, and per-branch change folding.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock(
  "../../../../src/components/device/automation-editor/automation-condition-tree.js",
  () => ({})
);
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import type {
  ActionNode,
  ChooseBranch,
  ConditionNode,
} from "../../../../src/api/types/automations.js";
import type { ESPHomeAutomationActionList } from "../../../../src/components/device/automation-editor/automation-action-list.js";
import { ESPHomeAutomationChooseBranches } from "../../../../src/components/device/automation-editor/automation-choose-branches.js";
import type { ESPHomeAutomationConditionTree } from "../../../../src/components/device/automation-editor/automation-condition-tree.js";

const cold: ChooseBranch = {
  conditions: [{ condition_id: "sensor.in_range", params: { id: "t", below: 10 } }],
  actions: [{ action_id: "logger.log", params: { format: "cold" } }],
};
const warm: ChooseBranch = {
  conditions: [{ condition_id: "sensor.in_range", params: { id: "t", below: 25 } }],
  actions: [{ action_id: "logger.log", params: { format: "warm" } }],
};

async function mount(branches: ChooseBranch[]) {
  const el = new ESPHomeAutomationChooseBranches();
  el.branches = branches;
  document.body.appendChild(el);
  await el.updateComplete;
  const seen: ChooseBranch[][] = [];
  el.addEventListener("branches-change", (e) =>
    seen.push((e as CustomEvent<{ branches: ChooseBranch[] }>).detail.branches)
  );
  return { el, seen };
}

function trees(el: ESPHomeAutomationChooseBranches) {
  return el.shadowRoot!.querySelectorAll<ESPHomeAutomationConditionTree>(
    "esphome-automation-condition-tree"
  );
}

function lists(el: ESPHomeAutomationChooseBranches) {
  return el.shadowRoot!.querySelectorAll<ESPHomeAutomationActionList>(
    "esphome-automation-action-list"
  );
}

describe("automation-choose-branches", () => {
  it("renders one condition tree and one action list per branch", async () => {
    const { el } = await mount([cold, warm]);
    expect(trees(el).length).toBe(2);
    expect(lists(el).length).toBe(2);
    expect(trees(el)[1].conditions).toEqual(warm.conditions);
    expect(lists(el)[1].actions).toEqual(warm.actions);
  });

  it("appends a blank branch on add", async () => {
    const { el, seen } = await mount([cold]);
    el.shadowRoot!.querySelector<HTMLButtonElement>(".ae-add")!.click();
    expect(seen).toEqual([[cold, { conditions: [], actions: [] }]]);
  });

  it("removes and reorders branches", async () => {
    const { el, seen } = await mount([cold, warm]);
    el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".ae-row-delete")[0].click();
    expect(seen[seen.length - 1]).toEqual([warm]);
    el.shadowRoot!.querySelectorAll<HTMLButtonElement>(
      ".ae-row-controls button"
    )[1].click();
    expect(seen[seen.length - 1]).toEqual([warm, cold]);
  });

  it("folds a branch's conditions-change and actions-change into that branch only", async () => {
    const { el, seen } = await mount([cold, warm]);
    const conditions: ConditionNode[] = [{ condition_id: "api.connected", params: {} }];
    trees(el)[1].dispatchEvent(
      new CustomEvent("conditions-change", {
        detail: { conditions },
        bubbles: true,
        composed: true,
      })
    );
    expect(seen[seen.length - 1]).toEqual([cold, { ...warm, conditions }]);
    const actions: ActionNode[] = [{ action_id: "delay", params: { id: "1s" } }];
    const outer: Event[] = [];
    el.addEventListener("actions-change", (e) => outer.push(e));
    lists(el)[0].dispatchEvent(
      new CustomEvent("actions-change", {
        detail: { actions },
        bubbles: true,
        composed: true,
      })
    );
    expect(seen[seen.length - 1]).toEqual([{ ...cold, actions }, warm]);
    expect(outer).toHaveLength(0);
  });
});
