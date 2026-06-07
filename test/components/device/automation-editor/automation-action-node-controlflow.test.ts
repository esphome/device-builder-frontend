/**
 * @vitest-environment happy-dom
 *
 * A control-flow action node renders its params form alongside its
 * nested action list; children must not suppress the params form.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

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
  "../../../../src/components/device/automation-editor/catalog-picker-dialog.js",
  () => ({})
);
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));

import type {
  ActionNode,
  AutomationAction,
} from "../../../../src/api/types/automations.js";
import type { ConfigEntry } from "../../../../src/api/types/config-entries.js";
import { ESPHomeAutomationActionNode } from "../../../../src/components/device/automation-editor/automation-action-node.js";

const countEntry = {
  key: "count",
  type: "integer",
  label: "Count",
  required: true,
} as unknown as ConfigEntry;

// The two assertions are driven purely by config_entries (params form)
// and accepts_action_list (nested list); the node reads neither
// is_control_flow nor any other field.
const repeatAction: AutomationAction = {
  id: "repeat",
  name: "Repeat",
  description: "",
  config_entries: [countEntry],
  accepts_action_list: ["then"],
} as unknown as AutomationAction;

const repeatNode: ActionNode = {
  action_id: "repeat",
  params: {},
  children: { then: [] },
} as unknown as ActionNode;

async function mountNode(): Promise<ESPHomeAutomationActionNode> {
  const el = new ESPHomeAutomationActionNode();
  el.value = repeatNode;
  el.catalog = [repeatAction];
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe("automation-action-node control-flow rendering (#1285)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the params form for a control-flow action that has nested children", async () => {
    const el = await mountNode();
    // Params form must render even though this action has a nested list.
    expect(el.shadowRoot!.querySelector("esphome-config-entry-form")).not.toBeNull();
  });

  it("renders the nested action list alongside the params form", async () => {
    const el = await mountNode();
    expect(el.shadowRoot!.querySelector("esphome-automation-action-list")).not.toBeNull();
  });
});
