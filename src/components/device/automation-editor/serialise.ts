/**
 * Helpers for the automation editor's path-based mutations.
 *
 * The editor passes the whole ``AutomationTree`` down through props
 * but doesn't mutate it in place — instead each sub-component emits
 * a change event with the new sub-value and the editor splices it
 * back into a fresh tree. These helpers centralise the immutability
 * so individual mutators stay one-liners.
 */
import type {
  ActionNode,
  AutomationTree,
  ConditionNode,
} from "../../../api/types.js";

/** Build a fresh empty automation tree (add-mode initial state). */
export function emptyAutomationTree(): AutomationTree {
  return {
    trigger_id: null,
    trigger_params: {},
    conditions: [],
    actions: [],
  };
}

/** Build a fresh empty action node for a given action id. */
export function emptyActionNode(actionId: string): ActionNode {
  return {
    action_id: actionId,
    params: {},
    children: {},
    conditions: [],
  };
}

/** Build a fresh empty condition node for a given condition id. */
export function emptyConditionNode(conditionId: string): ConditionNode {
  return {
    condition_id: conditionId,
    params: {},
    children: [],
  };
}

/**
 * Apply a single ``value-change`` from ``<esphome-config-entry-form>``
 * to a flat ``params`` dict. The form emits ``{path: string[], value}``;
 * the dict is keyed by the entry's top-level key, with nested entries
 * stored as sub-objects.
 */
export function applyParamChange(
  params: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  if (path.length === 0) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return { ...(value as Record<string, unknown>) };
    }
    return {};
  }
  const [head, ...rest] = path;
  if (rest.length === 0) {
    if (value === undefined || value === "") {
      const next = { ...params };
      delete next[head];
      return next;
    }
    return { ...params, [head]: value };
  }
  const child =
    params[head] && typeof params[head] === "object" && !Array.isArray(params[head])
      ? (params[head] as Record<string, unknown>)
      : {};
  return { ...params, [head]: applyParamChange(child, rest, value) };
}

/** Replace one item in an array, returning a fresh array. */
export function replaceAt<T>(arr: T[], index: number, value: T): T[] {
  if (index < 0 || index >= arr.length) return arr;
  const out = arr.slice();
  out[index] = value;
  return out;
}

/** Remove one item from an array, returning a fresh array. */
export function removeAt<T>(arr: T[], index: number): T[] {
  if (index < 0 || index >= arr.length) return arr;
  const out = arr.slice();
  out.splice(index, 1);
  return out;
}

/** Swap two adjacent items (used by the up/down reorder controls). */
export function swap<T>(arr: T[], i: number, j: number): T[] {
  if (i < 0 || j < 0 || i >= arr.length || j >= arr.length || i === j) return arr;
  const out = arr.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
