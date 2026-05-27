import { describe, expect, it } from "vitest";
import {
  applyParamChange,
  emptyActionNode,
  emptyAutomationTree,
  emptyConditionNode,
  removeAt,
  replaceAt,
  swap,
} from "../../../../src/components/device/automation-editor/serialise.js";

describe("emptyAutomationTree", () => {
  it("returns a tree with null trigger and empty containers", () => {
    const t = emptyAutomationTree();
    expect(t.trigger_id).toBeNull();
    expect(t.trigger_params).toEqual({});
    expect(t.actions).toEqual([]);
    // ESPHome triggers have no top-level boolean gate — there is
    // no ``conditions`` field at the tree level. Conditional
    // execution lives inside ``if`` / ``while`` / ``wait_until``
    // action nodes via their own ``conditions`` field.
    expect("conditions" in t).toBe(false);
  });
});

describe("emptyActionNode", () => {
  it("carries the action id and empty params / children / conditions", () => {
    const node = emptyActionNode("light.turn_on");
    expect(node.action_id).toBe("light.turn_on");
    expect(node.params).toEqual({});
    expect(node.children).toEqual({});
    expect(node.conditions).toEqual([]);
  });
});

describe("emptyConditionNode", () => {
  it("carries the condition id and empty params / children", () => {
    const node = emptyConditionNode("binary_sensor.is_on");
    expect(node.condition_id).toBe("binary_sensor.is_on");
    expect(node.params).toEqual({});
    expect(node.children).toEqual([]);
  });
});

describe("applyParamChange", () => {
  it("sets a top-level key", () => {
    const next = applyParamChange({}, ["foo"], "bar");
    expect(next).toEqual({ foo: "bar" });
  });

  it("merges into nested sub-objects", () => {
    const next = applyParamChange({ a: { b: 1 } }, ["a", "c"], 2);
    expect(next).toEqual({ a: { b: 1, c: 2 } });
  });

  it("creates intermediate sub-objects when missing", () => {
    const next = applyParamChange({}, ["a", "b", "c"], 1);
    expect(next).toEqual({ a: { b: { c: 1 } } });
  });

  it("removes keys when the value is undefined or empty string", () => {
    expect(applyParamChange({ a: 1, b: 2 }, ["a"], undefined)).toEqual({ b: 2 });
    expect(applyParamChange({ a: 1, b: 2 }, ["a"], "")).toEqual({ b: 2 });
  });

  it("returns a fresh top-level object — no mutation", () => {
    const orig = { a: 1 };
    const next = applyParamChange(orig, ["b"], 2);
    expect(orig).toEqual({ a: 1 });
    expect(next).not.toBe(orig);
  });

  it("returns a fresh sub-object — no nested mutation", () => {
    const orig = { a: { b: 1 } };
    const next = applyParamChange(orig, ["a", "c"], 2);
    expect(orig.a).toEqual({ b: 1 });
    expect(next.a).not.toBe(orig.a);
  });

  it("collapses an empty path to a record-replace", () => {
    const next = applyParamChange({ stale: 1 }, [], { fresh: 2 });
    expect(next).toEqual({ fresh: 2 });
  });

  it("clears the dict when the empty-path value isn't an object", () => {
    const next = applyParamChange({ stale: 1 }, [], "not an object");
    expect(next).toEqual({});
  });
});

describe("replaceAt / removeAt / swap", () => {
  it("replaces by index without mutating the source", () => {
    const src = [1, 2, 3];
    const next = replaceAt(src, 1, 99);
    expect(next).toEqual([1, 99, 3]);
    expect(src).toEqual([1, 2, 3]);
  });

  it("removes by index without mutating the source", () => {
    const src = [1, 2, 3];
    const next = removeAt(src, 1);
    expect(next).toEqual([1, 3]);
    expect(src).toEqual([1, 2, 3]);
  });

  it("swaps without mutating the source", () => {
    const src = [1, 2, 3];
    const next = swap(src, 0, 2);
    expect(next).toEqual([3, 2, 1]);
    expect(src).toEqual([1, 2, 3]);
  });

  it("is a no-op for out-of-bounds replaceAt / removeAt / swap", () => {
    expect(replaceAt([1, 2], -1, 9)).toEqual([1, 2]);
    expect(replaceAt([1, 2], 5, 9)).toEqual([1, 2]);
    expect(removeAt([1, 2], -1)).toEqual([1, 2]);
    expect(removeAt([1, 2], 5)).toEqual([1, 2]);
    expect(swap([1, 2], -1, 0)).toEqual([1, 2]);
    expect(swap([1, 2], 0, 5)).toEqual([1, 2]);
    expect(swap([1, 2], 1, 1)).toEqual([1, 2]);
  });
});
