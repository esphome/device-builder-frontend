/**
 * YAML-cursor → automation-tree focus resolution.
 *
 * The YAML pane reports an indexed key path (``["binary_sensor", 0,
 * "on_click", 0, "then", 0, "if", "condition", 0, "sensor.in_range",
 * "above"]``); these helpers slice it down to the automation handler
 * body and walk it against the backend-decomposed ``AutomationTree``
 * so the editor can scroll/highlight the clicked node or field. The
 * walk mirrors the backend's ``_decompose.py`` YAML shapes (explicit
 * ``then:`` vs bare list vs single bare action, dict-form conditions,
 * ``wait_until``'s gate-less shorthand) and fails soft: an unresolved
 * tail degrades to the deepest resolved node.
 */
import type {
  ActionNode,
  AutomationLocation,
  AutomationTree,
  ConditionNode,
} from "../../../api/types/automations.js";
import type { YamlPathSegment } from "../../../util/yaml-ast.js";

export type { YamlPathSegment };

/** Tree coordinates for one focus target inside an automation. */
export interface AutomationFocus {
  /** Path through the tree. ``[]`` = the trigger-params form. A number
   *  indexes the current action/condition list; ``"conditions"`` enters
   *  an ``ActionNode``'s boolean gate (reserved — YAML gate keys are
   *  ``condition``/``all``/``any``, never a child-list key); any other
   *  string is an ``accepts_action_list`` child key (``then``/``else``). */
  node: YamlPathSegment[];
  /** Params-form-relative field path; ``[]`` = highlight the node row. */
  field: string[];
}

/** Action-body keys that introduce a condition gate rather than params. */
const CONDITION_GATE_KEYS: ReadonlySet<string> = new Set(["condition", "all", "any"]);

/**
 * Slice a document-absolute indexed key path down to the handler body
 * addressed by *location*.
 *
 * The prefix before the handler key isn't re-verified — the caller
 * resolved *location* from the same cursor position, so they agree by
 * construction. Returns ``null`` when the path doesn't reach the
 * handler (or the location kind mounts a different editor).
 */
export function automationRelativePath(
  path: readonly YamlPathSegment[],
  location: AutomationLocation | null
): YamlPathSegment[] | null {
  if (!location) return null;
  switch (location.kind) {
    case "device_on":
    case "component_on": {
      const at = path.indexOf(location.trigger);
      if (at < 0) return null;
      const rest = path.slice(at + 1);
      if (location.index === undefined) return rest;
      return rest[0] === location.index ? rest.slice(1) : null;
    }
    case "component_action": {
      const at = path.indexOf(location.field);
      return at < 0 ? null : path.slice(at + 1);
    }
    case "interval":
      return path[0] === "interval" && path[1] === location.index ? path.slice(2) : null;
    default:
      // script / api_action / light_effect mount different editors.
      return null;
  }
}

/**
 * Walk a handler-relative path against the decomposed tree.
 *
 * Returns ``null`` only when nothing resolves at all (empty path, or a
 * top-level list index into an empty tree); once inside the tree an
 * unresolvable tail returns the deepest resolved node with ``field: []``.
 */
export function resolveAutomationFocus(
  tree: AutomationTree,
  relPath: readonly YamlPathSegment[]
): AutomationFocus | null {
  if (relPath.length === 0) return null;
  const head = relPath[0];
  if (head === "then") return actionListFocus(tree.actions, relPath.slice(1), [], null);
  if (typeof head === "number") return actionListFocus(tree.actions, relPath, [], null);
  // Single-bare-action shortcut: the mapping mixes trigger params and
  // action ids, so try the actions the decomposer pulled out first.
  const bare = tree.actions.findIndex((a) => a.action_id === head);
  if (bare >= 0) return actionBodyFocus(tree.actions[bare], relPath.slice(1), [bare]);
  return { node: [], field: relPath.map(String) };
}

/** Focus slice for the next level down — peels the segment the current
 *  render layer consumed. */
export function childFocus(focus: AutomationFocus): AutomationFocus {
  return { node: focus.node.slice(1), field: focus.field };
}

/** Value key for dedupe — the parent re-slices a fresh object per render. */
export function focusKey(focus: AutomationFocus | null | undefined): string | undefined {
  return focus ? JSON.stringify([focus.node, focus.field]) : undefined;
}

/** ``@property`` comparator for ``focusTarget``: parents mint a fresh
 *  (deep-equal) slice per render; only a value change should dirty the
 *  subtree. */
export function focusTargetHasChanged(a: unknown, b: unknown): boolean {
  return focusKey(a as AutomationFocus | null) !== focusKey(b as AutomationFocus | null);
}

function actionListFocus(
  nodes: ActionNode[],
  path: readonly YamlPathSegment[],
  at: YamlPathSegment[],
  fallback: AutomationFocus | null
): AutomationFocus | null {
  if (path.length === 0) return fallback;
  const head = path[0];
  if (typeof head === "number") {
    const wrapper = path[1];
    if (typeof wrapper === "string") {
      // A hand-written multi-key item decomposes to several nodes and
      // shifts later indices, so fall back to an id search on mismatch.
      const idx =
        nodes[head]?.action_id === wrapper
          ? head
          : nodes.findIndex((a) => a.action_id === wrapper);
      if (idx >= 0) return actionBodyFocus(nodes[idx], path.slice(2), [...at, idx]);
    }
    return nodes[head] ? { node: [...at, head], field: [] } : fallback;
  }
  // A list-key body given a single mapping instead of a list.
  const idx = nodes.findIndex((a) => a.action_id === head);
  if (idx >= 0) return actionBodyFocus(nodes[idx], path.slice(1), [...at, idx]);
  return fallback;
}

function actionBodyFocus(
  a: ActionNode,
  path: readonly YamlPathSegment[],
  at: YamlPathSegment[]
): AutomationFocus {
  const here: AutomationFocus = { node: at, field: [] };
  if (path.length === 0) return here;
  const head = path[0];
  if (typeof head === "string") {
    if (CONDITION_GATE_KEYS.has(head)) {
      return conditionListFocus(
        a.conditions ?? [],
        path.slice(1),
        [...at, "conditions"],
        here
      );
    }
    if (a.children && head in a.children) {
      return (
        actionListFocus(a.children[head], path.slice(1), [...at, head], here) ?? here
      );
    }
    if (a.conditions?.some((c) => c.condition_id === head)) {
      // ``wait_until``'s dict shorthand omits the gate key — the
      // segment is the condition id itself.
      return conditionListFocus(a.conditions, path, [...at, "conditions"], here);
    }
  }
  return { node: at, field: path.map(String) };
}

function conditionListFocus(
  conds: ConditionNode[],
  path: readonly YamlPathSegment[],
  at: YamlPathSegment[],
  fallback: AutomationFocus
): AutomationFocus {
  if (path.length === 0) return fallback;
  const head = path[0];
  if (typeof head === "number") {
    const wrapper = path[1];
    if (typeof wrapper === "string") {
      const idx =
        conds[head]?.condition_id === wrapper
          ? head
          : conds.findIndex((c) => c.condition_id === wrapper);
      if (idx >= 0) return conditionBodyFocus(conds[idx], path.slice(2), [...at, idx]);
    }
    return conds[head] ? { node: [...at, head], field: [] } : fallback;
  }
  // Dict form: a single condition carried as a mapping, no list index.
  const idx = conds.findIndex((c) => c.condition_id === head);
  if (idx >= 0) return conditionBodyFocus(conds[idx], path.slice(1), [...at, idx]);
  return fallback;
}

function conditionBodyFocus(
  c: ConditionNode,
  path: readonly YamlPathSegment[],
  at: YamlPathSegment[]
): AutomationFocus {
  const here: AutomationFocus = { node: at, field: [] };
  if (path.length === 0) return here;
  const kids = c.children ?? [];
  const head = path[0];
  if (
    kids.length > 0 &&
    (typeof head === "number" || kids.some((k) => k.condition_id === head))
  ) {
    // Combinator (``and``/``or``/``not``…) — recurse; from here down the
    // node path is condition-list indices only.
    return conditionListFocus(kids, path, at, here);
  }
  return { node: at, field: path.map(String) };
}
