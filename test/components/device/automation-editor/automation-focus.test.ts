/**
 * Truth table for the YAML-cursor → automation-tree focus resolution:
 * slicing a document-absolute path to the handler body, and walking it
 * against the decomposed tree across every YAML shorthand shape.
 */
import { describe, expect, it } from "vitest";

import type {
  ActionNode,
  AutomationTree,
  ConditionNode,
} from "../../../../src/api/types/automations.js";
import {
  automationRelativePath,
  childFocus,
  focusKey,
  resolveAutomationFocus,
} from "../../../../src/components/device/automation-editor/automation-focus.js";

function action(id: string, extra: Partial<ActionNode> = {}): ActionNode {
  return { action_id: id, params: {}, children: {}, conditions: [], ...extra };
}

function condition(id: string, extra: Partial<ConditionNode> = {}): ConditionNode {
  return { condition_id: id, params: {}, children: [], ...extra };
}

function tree(actions: ActionNode[]): AutomationTree {
  return { trigger_id: null, trigger_params: {}, actions };
}

// The apollo-starter-kit repro: on_click → then → if → two in_range
// conditions → logger.log.
const REPRO = tree([
  action("if", {
    conditions: [
      condition("sensor.in_range", { params: { id: "t", above: 20 } }),
      condition("sensor.in_range", { params: { id: "h", above: 20 } }),
    ],
    children: { then: [action("logger.log", { params: { format: "warm" } })] },
  }),
]);

describe("automationRelativePath", () => {
  it("slices past a component_on trigger with a list index", () => {
    expect(
      automationRelativePath(["binary_sensor", 0, "on_click", 0, "then", 0, "if"], {
        kind: "component_on",
        component_id: "button_module",
        trigger: "on_click",
        index: 0,
      })
    ).toEqual(["then", 0, "if"]);
  });

  it("slices a mapping-form trigger without an index", () => {
    expect(
      automationRelativePath(["binary_sensor", 0, "on_press", "min_length"], {
        kind: "component_on",
        component_id: "b",
        trigger: "on_press",
      })
    ).toEqual(["min_length"]);
  });

  it("finds the trigger key under a sub-entity host", () => {
    expect(
      automationRelativePath(["sensor", 0, "temperature", "on_value", "then", 0], {
        kind: "component_on",
        component_id: "sensor",
        trigger: "on_value",
      })
    ).toEqual(["then", 0]);
  });

  it("slices device_on with and without an index", () => {
    const loc = { kind: "device_on", trigger: "on_boot" } as const;
    expect(automationRelativePath(["esphome", "on_boot", "then", 0], loc)).toEqual([
      "then",
      0,
    ]);
    expect(
      automationRelativePath(["esphome", "on_boot", 1, "priority"], {
        ...loc,
        index: 1,
      })
    ).toEqual(["priority"]);
  });

  it("slices component_action on its field key", () => {
    expect(
      automationRelativePath(["cover", 0, "open_action", 0, "logger.log"], {
        kind: "component_action",
        component_id: "cover_1",
        field: "open_action",
      })
    ).toEqual([0, "logger.log"]);
  });

  it("slices interval by index", () => {
    expect(
      automationRelativePath(["interval", 2, "then", 0], { kind: "interval", index: 2 })
    ).toEqual(["then", 0]);
    expect(
      automationRelativePath(["interval", 1, "then"], { kind: "interval", index: 2 })
    ).toBeNull();
  });

  it("rejects a path outside the located handler", () => {
    expect(
      automationRelativePath(["binary_sensor", 0, "name"], {
        kind: "component_on",
        component_id: "b",
        trigger: "on_click",
        index: 0,
      })
    ).toBeNull();
    // Wrong list entry of a list-shaped trigger.
    expect(
      automationRelativePath(["time", 0, "on_time", 1, "seconds"], {
        kind: "component_on",
        component_id: "time",
        trigger: "on_time",
        index: 0,
      })
    ).toBeNull();
  });

  it("returns null for kinds that mount other editors", () => {
    expect(
      automationRelativePath(["script", 0, "then"], { kind: "script", id: "s" })
    ).toBeNull();
    expect(
      automationRelativePath(["api", "actions", 0], {
        kind: "api_action",
        action_name: "a",
      })
    ).toBeNull();
  });
});

describe("resolveAutomationFocus", () => {
  it("resolves the repro path to the first condition's above field", () => {
    expect(
      resolveAutomationFocus(REPRO, [
        "then",
        0,
        "if",
        "condition",
        0,
        "sensor.in_range",
        "above",
      ])
    ).toEqual({ node: [0, "conditions", 0], field: ["above"] });
  });

  it("resolves the second condition by its list index", () => {
    expect(
      resolveAutomationFocus(REPRO, [
        "then",
        0,
        "if",
        "condition",
        1,
        "sensor.in_range",
        "above",
      ])
    ).toEqual({ node: [0, "conditions", 1], field: ["above"] });
  });

  it("resolves a nested then-branch action to node level", () => {
    expect(
      resolveAutomationFocus(REPRO, ["then", 0, "if", "then", 0, "logger.log"])
    ).toEqual({ node: [0, "then", 0], field: [] });
  });

  it("routes a non-action key to the trigger params form", () => {
    expect(resolveAutomationFocus(REPRO, ["min_length"])).toEqual({
      node: [],
      field: ["min_length"],
    });
  });

  it("resolves the bare action-list form without a then wrapper", () => {
    expect(
      resolveAutomationFocus(tree([action("light.turn_on")]), [
        0,
        "light.turn_on",
        "brightness",
      ])
    ).toEqual({ node: [0], field: ["brightness"] });
  });

  it("resolves the single-bare-action shortcut mixed with trigger params", () => {
    const t = tree([action("switch.toggle", { params: { id: "relay" } })]);
    expect(resolveAutomationFocus(t, ["switch.toggle", "id"])).toEqual({
      node: [0],
      field: ["id"],
    });
    expect(resolveAutomationFocus(t, ["min_length"])).toEqual({
      node: [],
      field: ["min_length"],
    });
  });

  it("resolves a dict-form condition with no list index", () => {
    const t = tree([action("if", { conditions: [condition("api.connected")] })]);
    expect(
      resolveAutomationFocus(t, ["then", 0, "if", "condition", "api.connected"])
    ).toEqual({ node: [0, "conditions", 0], field: [] });
  });

  it("recurses into a combinator's children by index", () => {
    const t = tree([
      action("if", {
        conditions: [
          condition("or", {
            children: [
              condition("sensor.in_range", { params: { above: 1 } }),
              condition("sensor.in_range", { params: { below: 2 } }),
            ],
          }),
        ],
      }),
    ]);
    expect(
      resolveAutomationFocus(t, [
        "then",
        0,
        "if",
        "condition",
        0,
        "or",
        1,
        "sensor.in_range",
        "below",
      ])
    ).toEqual({ node: [0, "conditions", 0, 1], field: ["below"] });
  });

  it("resolves wait_until's gate-less dict shorthand and its timeout param", () => {
    const t = tree([action("wait_until", { conditions: [condition("api.connected")] })]);
    expect(resolveAutomationFocus(t, ["then", 0, "wait_until", "api.connected"])).toEqual(
      {
        node: [0, "conditions", 0],
        field: [],
      }
    );
    expect(resolveAutomationFocus(t, ["then", 0, "wait_until", "timeout"])).toEqual({
      node: [0],
      field: ["timeout"],
    });
  });

  it("resolves if-inside-if through nested then/else lists", () => {
    const inner = action("if", {
      conditions: [condition("api.connected")],
      children: { then: [action("logger.log")] },
    });
    const t = tree([
      action("if", { children: { then: [inner], else: [action("delay")] } }),
    ]);
    expect(
      resolveAutomationFocus(t, [
        "then",
        0,
        "if",
        "then",
        0,
        "if",
        "condition",
        "api.connected",
      ])
    ).toEqual({ node: [0, "then", 0, "conditions", 0], field: [] });
    expect(resolveAutomationFocus(t, ["then", 0, "if", "else", 0, "delay"])).toEqual({
      node: [0, "else", 0],
      field: [],
    });
  });

  it("terminates at node level on a scalar shorthand", () => {
    // ``- logger.log: warm`` — the cursor path ends at the action id key,
    // never reaching the shorthand-mapped param.
    const t = tree([action("logger.log", { params: { format: "warm" } })]);
    expect(resolveAutomationFocus(t, ["then", 0, "logger.log"])).toEqual({
      node: [0],
      field: [],
    });
  });

  it("falls back to an id search when a multi-key item shifted indices", () => {
    const t = tree([action("logger.log"), action("switch.toggle")]);
    // YAML item 1 is switch.toggle but a multi-key item 0 pushed it to
    // node index 1 already; a mismatched index still finds it by id.
    expect(resolveAutomationFocus(t, ["then", 0, "switch.toggle", "id"])).toEqual({
      node: [1],
      field: ["id"],
    });
  });

  it("fails soft to the deepest resolved node", () => {
    // Unknown child key under the if → the if node itself.
    expect(
      resolveAutomationFocus(REPRO, ["then", 0, "if", "bogus_list", 0, "x"])
    ).toEqual({ node: [0], field: ["bogus_list", "0", "x"] });
    // Out-of-range condition index with a known wrapper id → the id
    // search lands on a same-id sibling rather than losing the target.
    expect(
      resolveAutomationFocus(REPRO, ["then", 0, "if", "condition", 9, "sensor.in_range"])
    ).toEqual({ node: [0, "conditions", 0], field: [] });
    // Out-of-range condition index with no wrapper → the enclosing action.
    expect(resolveAutomationFocus(REPRO, ["then", 0, "if", "condition", 9])).toEqual({
      node: [0],
      field: [],
    });
    // Out-of-range action index with no wrapper → nothing to anchor.
    expect(resolveAutomationFocus(tree([]), ["then", 5])).toBeNull();
  });

  it("treats a prototype-named param key as a field, not a child list", () => {
    // ``constructor`` is inherited by every plain object; ``in`` on the
    // wire tree's children would route into Object.prototype and crash.
    expect(resolveAutomationFocus(REPRO, ["then", 0, "if", "constructor", 0])).toEqual({
      node: [0],
      field: ["constructor", "0"],
    });
  });

  it("returns null on an empty relative path", () => {
    expect(resolveAutomationFocus(REPRO, [])).toBeNull();
  });
});

describe("focus helpers", () => {
  it("childFocus peels one node segment, keeping the field", () => {
    expect(childFocus({ node: [0, "conditions", 1], field: ["above"] })).toEqual({
      node: ["conditions", 1],
      field: ["above"],
    });
  });

  it("focusKey keys by value and maps null to undefined", () => {
    const a = focusKey({ node: [0], field: ["x"] });
    expect(a).toBe(focusKey({ node: [0], field: ["x"] }));
    expect(a).not.toBe(focusKey({ node: [0], field: ["y"] }));
    expect(focusKey(null)).toBeUndefined();
  });
});
