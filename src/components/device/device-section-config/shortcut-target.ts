import {
  instanceComponentId,
  parseYamlTopLevelSections,
  sectionKeyOf,
  type YamlSection,
} from "../../../util/yaml-sections.js";

/**
 * Per-section "+ Add automation" / triggers-list target: ``null`` for a
 * data-only block, ``device_on`` for the ``esphome:`` block, else
 * ``component_on`` keyed by the instance's addressable id. Pure over the
 * section's yaml/key/resolved-line plus an injected catalog gate, so the
 * gate's classification can be unit-tested without a DOM or live API.
 */
export type ShortcutTarget =
  | null
  | { kind: "device_on" }
  | { kind: "component_on"; componentId: string };

/**
 * Top-level keys that never host an inline trigger shortcut: ``api`` keeps
 * its dedicated add-action flow (PR #360); ``script`` / ``interval`` get
 * their navigator CTAs; the rest are data-only blocks where a trigger
 * handler doesn't make sense.
 */
export const SHORTCUT_HIDE_KEYS: ReadonlySet<string> = new Set([
  "api",
  "script",
  "interval",
  "external_components",
  "packages",
  "substitutions",
  "globals",
  "dashboard_import",
]);

export interface ComponentMatch {
  sections: YamlSection[];
  match: YamlSection;
}

/**
 * The configured component instance a section edits, matched by section
 * key and biased to the resolved fromLine for multi-instance domains.
 * ``null`` for non-component sections.
 */
export function resolveComponentMatch(
  yaml: string,
  sectionKey: string,
  resolvedFromLine?: number
): ComponentMatch | null {
  const sections = parseYamlTopLevelSections(yaml);
  const candidates = sections.filter((s) => sectionKeyOf(s) === sectionKey);
  if (candidates.length === 0) return null;
  const match =
    resolvedFromLine !== undefined
      ? (candidates.find((s) => s.fromLine === resolvedFromLine) ?? candidates[0])
      : candidates[0];
  return { sections, match };
}

/** Addressable id of the component instance a section edits, or null. */
export function resolveComponentId(
  yaml: string,
  sectionKey: string,
  resolvedFromLine?: number
): string | null {
  const matched = resolveComponentMatch(yaml, sectionKey, resolvedFromLine);
  return matched === null ? null : instanceComponentId(matched.sections, matched.match);
}

/**
 * Resolve the shortcut target for a section. ``hasTriggers`` injects the
 * trigger-catalog gate (``TriggerCatalogController.hasTriggersFor``) so a
 * trigger-less component like ``web_server:`` shows no panel: the scopes
 * cover the bare domain and the qualified ``<domain>.<platform>`` since a
 * trigger may be scoped to either (``switch`` vs ``output.slow_pwm``).
 */
export function resolveShortcutTarget(
  yaml: string,
  sectionKey: string,
  resolvedFromLine: number | undefined,
  hasTriggers: (scopes: string[]) => boolean
): ShortcutTarget {
  if (SHORTCUT_HIDE_KEYS.has(sectionKey)) return null;
  if (sectionKey === "esphome") return { kind: "device_on" };
  const matched = resolveComponentMatch(yaml, sectionKey, resolvedFromLine);
  if (matched === null) return null;
  const scopes = [matched.match.parentKey ?? matched.match.key, sectionKey];
  if (!hasTriggers(scopes)) return null;
  return {
    kind: "component_on",
    componentId: instanceComponentId(matched.sections, matched.match),
  };
}
