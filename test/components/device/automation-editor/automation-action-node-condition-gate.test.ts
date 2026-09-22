/**
 * @vitest-environment happy-dom
 *
 * The condition gate renders off the catalog's has_condition_gate flag,
 * not the action id.
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
} from "../../../../src/api/types/automations.js";
import { ESPHomeAutomationActionNode } from "../../../../src/components/device/automation-editor/automation-action-node.js";

async function mountNode(def: AutomationAction): Promise<ESPHomeAutomationActionNode> {
  const el = new ESPHomeAutomationActionNode();
  el.value = {
    action_id: def.id,
    params: {},
    children: {},
    conditions: [],
  } as ActionNode;
  el.catalog = [def];
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

function gate(el: ESPHomeAutomationActionNode): Element | null {
  return el.shadowRoot!.querySelector("esphome-automation-condition-tree");
}

describe("automation-action-node condition gate", () => {
  it("renders the gate for a flagged action", async () => {
    const el = await mountNode(
      makeAutomationAction({
        id: "while",
        is_control_flow: true,
        has_condition_gate: true,
        accepts_action_list: ["then"],
      })
    );
    expect(gate(el)).not.toBeNull();
  });

  it("renders no gate for control flow without the flag", async () => {
    const el = await mountNode(
      makeAutomationAction({
        id: "repeat",
        is_control_flow: true,
        accepts_action_list: ["then"],
      })
    );
    expect(gate(el)).toBeNull();
  });

  it("does not infer the gate from the action id", async () => {
    const el = await mountNode(
      makeAutomationAction({
        id: "if",
        is_control_flow: true,
        has_else_branch: true,
        accepts_action_list: ["then", "else"],
      })
    );
    expect(gate(el)).toBeNull();
  });
});
