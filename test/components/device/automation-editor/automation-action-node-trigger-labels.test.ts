/**
 * @vitest-environment happy-dom
 *
 * A triggered action (http_request.get) renders one nested action list
 * per trigger key, each labeled by its humanized key so on_response and
 * on_error read distinctly; else keeps its control-flow wording.
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
import { mount } from "../../../_dom.js";

const urlEntry = {
  key: "url",
  type: "string",
  label: "URL",
  required: true,
} as unknown as ConfigEntry;

const httpGetAction: AutomationAction = {
  id: "http_request.get",
  name: "Http Request → Get",
  description: "",
  config_entries: [urlEntry],
  accepts_action_list: ["on_response", "on_error"],
} as unknown as AutomationAction;

const httpGetNode: ActionNode = {
  action_id: "http_request.get",
  params: {},
  children: { on_response: [], on_error: [] },
} as unknown as ActionNode;

function nestedLabels(el: ESPHomeAutomationActionNode): string[] {
  return [...el.shadowRoot!.querySelectorAll(".ae-nested-label")].map((p) =>
    p.textContent!.trim()
  );
}

describe("automation-action-node trigger labels (esphome/device-builder#1390)", () => {
  it("labels each trigger list by its humanized key", async () => {
    const el = await mount(new ESPHomeAutomationActionNode(), {
      value: httpGetNode,
      catalog: [httpGetAction],
    });
    expect(nestedLabels(el)).toEqual(["On Response", "On Error"]);
  });

  it("humanizes a multi-word trigger key", async () => {
    const action = {
      id: "binary_sensor.x",
      name: "X",
      description: "",
      config_entries: [],
      accepts_action_list: ["on_multi_click"],
    } as unknown as AutomationAction;
    const node = {
      action_id: "binary_sensor.x",
      params: {},
      children: { on_multi_click: [] },
    } as unknown as ActionNode;
    const el = await mount(new ESPHomeAutomationActionNode(), {
      value: node,
      catalog: [action],
    });
    expect(nestedLabels(el)).toEqual(["On Multi Click"]);
  });

  it("renders one nested action list per trigger key alongside the params form", async () => {
    const el = await mount(new ESPHomeAutomationActionNode(), {
      value: httpGetNode,
      catalog: [httpGetAction],
    });
    expect(
      el.shadowRoot!.querySelectorAll("esphome-automation-action-list")
    ).toHaveLength(2);
    expect(el.shadowRoot!.querySelector("esphome-config-entry-form")).not.toBeNull();
  });

  it("keeps then and else routed through the control-flow localization keys", async () => {
    const ifAction = {
      id: "if",
      name: "If",
      description: "",
      config_entries: [],
      accepts_action_list: ["then", "else"],
    } as unknown as AutomationAction;
    const ifNode = {
      action_id: "if",
      params: {},
      children: { then: [], else: [] },
    } as unknown as ActionNode;
    const el = await mount(new ESPHomeAutomationActionNode(), {
      value: ifNode,
      catalog: [ifAction],
    });
    // Default _localize echoes the key; else takes the localize branch,
    // not the humanizer (which would emit "Else").
    const labels = nestedLabels(el);
    expect(labels).toContain("device.automation_else");
    expect(labels).not.toContain("Else");
    // then keeps its control-flow wording, not a title-cased "Then".
    expect(labels).toContain("device.automation_action");
    expect(labels).not.toContain("Then");
  });
});
