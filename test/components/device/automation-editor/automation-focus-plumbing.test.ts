/**
 * @vitest-environment happy-dom
 *
 * The focus target threads from the editor through list → node →
 * condition tree, arming the right leaf form's ``focusFieldPath``,
 * un-collapsing collapsed cards, revealing advanced params, and
 * degrading to a row scroll when the target terminates on a node.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/components/device/config-entry-form.js", () => ({}));
vi.mock(
  "../../../../src/components/device/automation-editor/automation-target-picker.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/automation-trigger-picker.js",
  () => ({})
);
vi.mock(
  "../../../../src/components/device/automation-editor/catalog-picker-dialog.js",
  () => ({})
);
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/spinner/spinner.js", () => ({}));
vi.mock("sonner-js", () => ({ default: { error: vi.fn() } }));

import type { ESPHomeAPI } from "../../../../src/api/index.js";
import type {
  ActionNode,
  AutomationAction,
  AutomationCondition,
  AvailableAutomations,
  ConditionNode,
} from "../../../../src/api/types/automations.js";
import type { ConfigEntry } from "../../../../src/api/types/config-entries.js";
import { ESPHomeAutomationActionList } from "../../../../src/components/device/automation-editor/automation-action-list.js";
import { ESPHomeAutomationActionNode } from "../../../../src/components/device/automation-editor/automation-action-node.js";
import { ESPHomeAutomationConditionTree } from "../../../../src/components/device/automation-editor/automation-condition-tree.js";
import { ESPHomeAutomationEditor } from "../../../../src/components/device/automation-editor/automation-editor.js";
import type { AutomationFocus } from "../../../../src/components/device/automation-editor/automation-focus.js";
import { flushMicrotasks, mount } from "../../../_dom.js";

const entry = (key: string, advanced = false) =>
  ({ key, type: "string", label: key, advanced }) as unknown as ConfigEntry;

const IF_DEF = {
  id: "if",
  name: "If",
  description: "",
  config_entries: [],
  accepts_action_list: ["then", "else"],
} as unknown as AutomationAction;

const LOG_DEF = {
  id: "logger.log",
  name: "Log",
  description: "",
  config_entries: [entry("format"), entry("level", true)],
  accepts_action_list: [],
} as unknown as AutomationAction;

const IN_RANGE_DEF = {
  id: "sensor.in_range",
  name: "In range",
  description: "",
  config_entries: [entry("above"), entry("below")],
  accepts_condition_list: false,
} as unknown as AutomationCondition;

const OR_DEF = {
  id: "or",
  name: "Or",
  description: "",
  config_entries: [],
  accepts_condition_list: true,
} as unknown as AutomationCondition;

const inRange = (params: Record<string, unknown> = {}): ConditionNode => ({
  condition_id: "sensor.in_range",
  params,
  children: [],
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("action-list focus slicing", () => {
  it("hands the sliced target to the indexed row only", async () => {
    const list = new ESPHomeAutomationActionList();
    list.actions = [
      { action_id: "logger.log", params: {}, children: {}, conditions: [] },
      { action_id: "if", params: {}, children: {}, conditions: [inRange()] },
    ];
    list.catalog = [IF_DEF, LOG_DEF];
    list.conditionCatalog = [IN_RANGE_DEF];
    list.focusTarget = { node: [1, "conditions", 0], field: ["above"] };
    await mount(list);

    const rows = list.shadowRoot!.querySelectorAll("esphome-automation-action-node");
    expect((rows[0] as ESPHomeAutomationActionNode).focusTarget).toBeNull();
    expect((rows[1] as ESPHomeAutomationActionNode).focusTarget).toEqual({
      node: ["conditions", 0],
      field: ["above"],
    });
  });
});

describe("action-node focus routing", () => {
  async function mountNode(
    value: ActionNode,
    focusTarget: AutomationFocus | null
  ): Promise<ESPHomeAutomationActionNode> {
    const el = new ESPHomeAutomationActionNode();
    el.value = value;
    el.catalog = [IF_DEF, LOG_DEF];
    el.conditionCatalog = [IN_RANGE_DEF, OR_DEF];
    el.focusTarget = focusTarget;
    await mount(el);
    return el;
  }

  it("routes a conditions head into the gate tree, sliced", async () => {
    const el = await mountNode(
      { action_id: "if", params: {}, children: {}, conditions: [inRange()] },
      { node: ["conditions", 0], field: ["above"] }
    );
    const tree = el.shadowRoot!.querySelector(
      "esphome-automation-condition-tree"
    ) as ESPHomeAutomationConditionTree;
    expect(tree.focusTarget).toEqual({ node: [0], field: ["above"] });
  });

  it("routes a child-list key into that nested list, sliced", async () => {
    const el = await mountNode(
      {
        action_id: "if",
        params: {},
        children: { then: [], else: [] },
        conditions: [],
      },
      { node: ["else", 0], field: [] }
    );
    const lists = el.shadowRoot!.querySelectorAll("esphome-automation-action-list");
    const byLabel = (label: string) =>
      [...lists].find((l) =>
        l.parentElement?.textContent?.toLowerCase().includes(label)
      ) as ESPHomeAutomationActionList;
    expect(byLabel("else").focusTarget).toEqual({ node: [0], field: [] });
    expect(byLabel("action").focusTarget).toBeNull();
  });

  it("arms the params form's focusFieldPath for a field target", async () => {
    // The advanced reveal itself is the form's job (one-shot
    // advanced-toggle, pinned in config-entry-form-advanced-section).
    const el = await mountNode(
      { action_id: "logger.log", params: {}, children: {}, conditions: [] },
      { node: [], field: ["level"] }
    );
    const form = el.shadowRoot!.querySelector("esphome-config-entry-form");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((form as any).focusFieldPath).toEqual(["level"]);
  });

  it("un-collapses a collapsed card so the target can render", async () => {
    const el = await mountNode(
      { action_id: "logger.log", params: {}, children: {}, conditions: [] },
      null
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._collapsed = true;
    await el.updateComplete;
    el.focusTarget = { node: [], field: ["format"] };
    await el.updateComplete;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._collapsed).toBe(false);
    expect(el.shadowRoot!.querySelector("esphome-config-entry-form")).not.toBeNull();
  });

  it("scrolls and flashes the row once for a node-level target", async () => {
    const scrolled = vi
      .spyOn(HTMLElement.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    const el = await mountNode(
      { action_id: "logger.log", params: {}, children: {}, conditions: [] },
      { node: [], field: [] }
    );
    expect(scrolled).toHaveBeenCalledTimes(1);
    // A re-render with the same target must not re-scroll.
    el.focusTarget = { node: [], field: [] };
    await el.updateComplete;
    expect(scrolled).toHaveBeenCalledTimes(1);
  });
});

describe("condition-tree focus routing", () => {
  it("arms the targeted leaf form and leaves siblings alone", async () => {
    const tree = new ESPHomeAutomationConditionTree();
    tree.conditions = [inRange({ above: 20 }), inRange({ above: 30 })];
    tree.catalog = [IN_RANGE_DEF];
    tree.focusTarget = { node: [1], field: ["above"] };
    await mount(tree);

    const forms = tree.shadowRoot!.querySelectorAll("esphome-config-entry-form");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((forms[0] as any).focusFieldPath).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((forms[1] as any).focusFieldPath).toEqual(["above"]);
  });

  it("recurses a deeper target into the combinator's child tree", async () => {
    const tree = new ESPHomeAutomationConditionTree();
    tree.conditions = [
      { condition_id: "or", params: {}, children: [inRange(), inRange()] },
    ];
    tree.catalog = [IN_RANGE_DEF, OR_DEF];
    tree.focusTarget = { node: [0, 1], field: ["below"] };
    await mount(tree);

    const nested = tree.shadowRoot!.querySelector(
      "esphome-automation-condition-tree"
    ) as ESPHomeAutomationConditionTree;
    expect(nested.focusTarget).toEqual({ node: [1], field: ["below"] });
    const forms = nested.shadowRoot!.querySelectorAll("esphome-config-entry-form");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((forms[1] as any).focusFieldPath).toEqual(["below"]);
  });
});

describe("automation-editor focus resolution", () => {
  it("resolves the cursor path against its tree and hands it to the action list", async () => {
    const api = {
      getAvailableAutomations: vi.fn().mockResolvedValue({
        triggers: [],
        actions: [IF_DEF, LOG_DEF],
        conditions: [IN_RANGE_DEF],
        scripts: [],
        devices: [],
      } as unknown as AvailableAutomations),
      getAutomationBodies: vi.fn().mockResolvedValue({}),
      parseDeviceAutomations: vi.fn().mockResolvedValue([]),
    } as unknown as ESPHomeAPI;
    const editor = new ESPHomeAutomationEditor();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (editor as any)._api = api;
    editor.configuration = "device.yaml";
    editor.location = {
      kind: "component_on",
      component_id: "button_module",
      trigger: "on_click",
      index: 0,
    };
    editor.value = {
      trigger_id: null,
      trigger_params: {},
      actions: [{ action_id: "if", params: {}, children: {}, conditions: [inRange()] }],
    };
    editor.focusYamlPath = [
      "binary_sensor",
      0,
      "on_click",
      0,
      "then",
      0,
      "if",
      "condition",
      0,
      "sensor.in_range",
      "above",
    ];
    await mount(editor);
    await flushMicrotasks(5);

    const list = editor.shadowRoot!.querySelector(
      "esphome-automation-action-list"
    ) as ESPHomeAutomationActionList;
    expect(list.focusTarget).toEqual({
      node: [0, "conditions", 0],
      field: ["above"],
    });
  });
});
