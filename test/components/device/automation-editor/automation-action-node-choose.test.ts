/**
 * @vitest-environment happy-dom
 *
 * A branch-list action (``choose``) renders its branch editor off the
 * catalog's has_branches flag, with its else list as the only nested list.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/device/config-entry-form.js", () => ({}));
vi.mock(
  "../../../../src/components/device/automation-editor/automation-action-list.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/automation-condition-tree.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/automation-choose-branches.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/catalog-picker-host.js",
  () => ({
    requestCatalogPick: () => {},
  })
);
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));

import { makeAutomationAction } from "../../../_make-automation-action.js";
import type {
  ActionNode,
  AutomationAction,
  ChooseBranch,
} from "../../../../src/api/types/automations.js";
import { ESPHomeAutomationActionNode } from "../../../../src/components/device/automation-editor/automation-action-node.js";
import type { ESPHomeAutomationChooseBranches } from "../../../../src/components/device/automation-editor/automation-choose-branches.js";

const chooseDef = makeAutomationAction({
  id: "choose",
  is_control_flow: true,
  has_else_branch: true,
  has_branches: true,
  accepts_action_list: ["else"],
});

const branch: ChooseBranch = {
  conditions: [{ condition_id: "api.connected", params: {} }],
  actions: [{ action_id: "logger.log", params: { format: "up" } }],
};

async function mountNode(def: AutomationAction, value: ActionNode) {
  const el = new ESPHomeAutomationActionNode();
  el.value = value;
  el.catalog = [def];
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("automation-action-node choose branches", () => {
  it("renders the branch editor and only the else list for a has_branches action", async () => {
    const el = await mountNode(chooseDef, {
      action_id: "choose",
      params: {},
      children: { else: [] },
      conditions: [],
      branches: [branch],
    });
    const branches = el.shadowRoot!.querySelector<ESPHomeAutomationChooseBranches>(
      "esphome-automation-choose-branches"
    );
    expect(branches).not.toBeNull();
    expect(branches!.branches).toEqual([branch]);
    const lists = el.shadowRoot!.querySelectorAll("esphome-automation-action-list");
    expect(lists.length).toBe(1);
    expect(el.shadowRoot!.querySelector("esphome-automation-condition-tree")).toBeNull();
  });

  it("renders no branch editor without the flag", async () => {
    const el = await mountNode(
      makeAutomationAction({
        id: "if",
        is_control_flow: true,
        has_condition_gate: true,
        accepts_action_list: ["then", "else"],
      }),
      { action_id: "if", params: {}, children: {}, conditions: [] }
    );
    expect(el.shadowRoot!.querySelector("esphome-automation-choose-branches")).toBeNull();
  });

  it("folds a branches-change into the node and re-emits action-change", async () => {
    const el = await mountNode(chooseDef, {
      action_id: "choose",
      params: {},
      children: {},
      conditions: [],
      branches: [branch],
    });
    const seen: ActionNode[] = [];
    el.addEventListener("action-change", (e) =>
      seen.push((e as CustomEvent<{ value: ActionNode }>).detail.value)
    );
    const editor = el.shadowRoot!.querySelector("esphome-automation-choose-branches")!;
    editor.dispatchEvent(
      new CustomEvent("branches-change", {
        detail: { branches: [branch, { conditions: [], actions: [] }] },
        bubbles: true,
        composed: true,
      })
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].branches).toHaveLength(2);
    expect(seen[0].action_id).toBe("choose");
  });
});
