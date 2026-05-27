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
  AutomationLocation,
  AutomationTree,
  ConditionNode,
  YamlDiff,
} from "../../../api/types.js";

/** Build a fresh empty automation tree (add-mode initial state). */
export function emptyAutomationTree(): AutomationTree {
  return {
    trigger_id: null,
    trigger_params: {},
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
  value: unknown
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

/**
 * Convert an ``AutomationLocation`` into the stable section key the
 * navigator emits (and the page consumes to route a click into the
 * automation editor). Mirrors the construction in
 * ``util/yaml-sections.ts::parseYamlAutomations``.
 */
export function sectionKeyFromLocation(loc: AutomationLocation): string {
  switch (loc.kind) {
    case "device_on":
      return `automation:device_on:${loc.trigger}`;
    case "component_on":
      return `automation:component_on:${loc.component_id}:${loc.trigger}`;
    case "script":
      return `automation:script:${loc.id}`;
    case "interval":
      return `automation:interval:${loc.index}`;
    case "light_effect":
      return `automation:light_effect:${loc.component_id}:${loc.index}`;
    case "api_action":
      return `automation:api_action:${loc.action_name}`;
  }
}

/**
 * Apply a backend-emitted ``YamlDiff`` to a YAML string locally.
 * The backend's ``automations/upsert`` and ``automations/delete``
 * commands return a diff rather than writing to disk — this is
 * how the frontend reflects the change into its in-memory YAML
 * buffer so the YAML pane updates and the global save button
 * activates (per the "editor pane is the single writer" rule
 * from the design).
 *
 * Diff shapes (per the backend's docs):
 * - Replace: ``fromLine <= toLine`` → lines ``[fromLine, toLine]``
 *   (1-indexed, inclusive) are replaced with ``replacement``.
 * - Insert: ``toLine == fromLine - 1`` → no lines replaced;
 *   ``replacement`` is inserted before line ``fromLine``.
 *
 * Both shapes funnel through one slice / concat pattern; a
 * trailing newline on ``replacement`` is normalised so the
 * resulting YAML doesn't grow a blank line on each edit.
 */
export function applyYamlDiff(yaml: string, diff: YamlDiff): string {
  const lines = yaml.split("\n");
  const startIdx = diff.fromLine - 1;
  const deleteCount = Math.max(0, diff.toLine - diff.fromLine + 1);
  // Strip a single trailing "\n" from replacement so when we
  // split on "\n" we don't end up with a phantom empty line at
  // the end of the inserted block. Multi-line replacements
  // emitted by the backend include their own intra-block
  // newlines; the trailing one is a delimiter we don't need.
  const replacementStr = diff.replacement.endsWith("\n")
    ? diff.replacement.slice(0, -1)
    : diff.replacement;
  const replacementLines = replacementStr === "" ? [] : replacementStr.split("\n");
  const newLines = [
    ...lines.slice(0, startIdx),
    ...replacementLines,
    ...lines.slice(startIdx + deleteCount),
  ];
  return newLines.join("\n");
}

/**
 * Parse a stable section key back into an ``AutomationLocation``.
 * Returns ``null`` for unrecognised forms (the synchronous fallback
 * parser emits ``automation:unscoped:…`` for unscoped handlers; those
 * have no canonical location).
 */
export function locationFromSectionKey(key: string): AutomationLocation | null {
  if (!key.startsWith("automation:")) return null;
  const parts = key.split(":");
  // parts[0] = "automation"
  switch (parts[1]) {
    case "device_on":
      return parts[2] ? { kind: "device_on", trigger: parts[2] } : null;
    case "component_on":
      return parts.length >= 4
        ? { kind: "component_on", component_id: parts[2], trigger: parts[3] }
        : null;
    case "script":
      return parts[2] ? { kind: "script", id: parts[2] } : null;
    case "interval": {
      const idx = Number(parts[2]);
      return Number.isFinite(idx) ? { kind: "interval", index: idx } : null;
    }
    case "light_effect": {
      const idx = Number(parts[3]);
      return parts[2] && Number.isFinite(idx)
        ? { kind: "light_effect", component_id: parts[2], index: idx }
        : null;
    }
    case "api_action":
      return parts[2] ? { kind: "api_action", action_name: parts[2] } : null;
    default:
      return null;
  }
}
