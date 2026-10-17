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
import { FIELD_FLASH_CLASS } from "../../../../src/components/device/field-highlight.js";

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

  it("keeps the last branch", async () => {
    const { el } = await mount([cold]);
    expect(
      el.shadowRoot!.querySelector<HTMLButtonElement>(".ae-row-delete")!.disabled
    ).toBe(true);
  });

  it("flashes the branch a terminal focus target names", async () => {
    const { el } = await mount([cold, warm]);
    const rows = el.shadowRoot!.querySelectorAll<HTMLElement>(".ae-nested");
    rows.forEach((row) => {
      row.scrollIntoView = () => {};
    });
    el.focusTarget = { node: [1], field: [] };
    await el.updateComplete;
    expect(rows[1].classList.contains(FIELD_FLASH_CLASS)).toBe(true);
    expect(rows[0].classList.contains(FIELD_FLASH_CLASS)).toBe(false);
  });

  it("hands a focus target to the branch by key, not by index after a move", async () => {
    const { el } = await mount([cold, warm]);
    el.focusTarget = { node: [0, "then", 0], field: [] };
    await el.updateComplete;
    expect(lists(el)[0].focusTarget).toEqual({ node: [0], field: [] });
    el.branches = [warm, cold];
    await el.updateComplete;
    expect(lists(el)[0].focusTarget).toBeNull();
    expect(lists(el)[1].focusTarget).toBeNull();
  });

  it("refocuses the move button after the branches swap", async () => {
    const hot: ChooseBranch = { conditions: [], actions: [] };
    const { el, seen } = await mount([cold, warm, hot]);
    const down = el.shadowRoot!.querySelectorAll<HTMLButtonElement>(
      ".ae-row-controls button"
    )[1];
    down.focus();
    down.click();
    el.branches = seen[seen.length - 1];
    await el.updateComplete;
    expect(el.branches).toEqual([warm, cold, hot]);
    expect(el.shadowRoot!.activeElement).toBe(down);
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
