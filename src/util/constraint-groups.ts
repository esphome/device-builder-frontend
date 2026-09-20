/**
 * Cross-field constraint groups (`required_groups` cardinality + inclusive
 * `group` all-or-none), evaluated reactively against the current scope values.
 *
 * The backend ships these structurally and, as a stopgap, also bakes prose
 * like "Required — set exactly one of: …" into each member's `description`.
 * The form strips that prose and renders a reactive banner instead, so an
 * optional member whose group is already satisfied by a sibling (e.g.
 * `esp32_rmt_led_strip` timings once `chipset` is set) stops reading "Required".
 */
import type {
  ConfigEntry,
  RequiredGroup,
  RequiredGroupKind,
} from "../api/types/config-entries.js";
import { isValuePresent } from "./config-validation.js";
import { isIndexSegment, isPlainObject } from "./nested-values.js";
import { hasSerializableValue } from "./yaml-serialize.js";

/** A `required_groups` kind, plus `all_or_none` for inclusive `group` ids. */
export type ConstraintKind = RequiredGroupKind | "all_or_none";

// Leading bold paragraphs the backend prepends to a member's description as a
// stopgap (`_annotate_constraint_descriptions`). The form renders these
// constraints reactively from the structured groups instead, so strip them.
const _CONSTRAINT_PARAGRAPH = /^\*\*(Required —|Set at most one of:|Set together)/;

/**
 * Drop the backend's baked constraint-prose paragraphs from a description.
 *
 * Transitional: the backend only bakes these as a stopgap; once it stops and
 * component data is re-synced, this and `_CONSTRAINT_PARAGRAPH` can be deleted.
 */
export function stripConstraintProse(description: string): string {
  // The baked paragraphs always lead with bold (`**`); skip the split for the
  // overwhelming majority of descriptions that don't.
  if (!description.startsWith("**")) return description;
  const paragraphs = description.split("\n\n");
  let start = 0;
  while (
    start < paragraphs.length &&
    _CONSTRAINT_PARAGRAPH.test(paragraphs[start].trim())
  ) {
    start++;
  }
  return paragraphs.slice(start).join("\n\n").trim();
}

/**
 * Whether *raw* counts as a set group member. A block counts only when it
 * would reach the YAML: the serializer prunes an object with nothing in it,
 * so an emptied ``pwm: {}`` is not set.
 */
export function isMemberSet(raw: unknown): boolean {
  return isPlainObject(raw) ? hasSerializableValue(raw) : isValuePresent(raw);
}

/** Does the cardinality constraint *kind* hold over *keys* in *values*? */
export function evaluateGroup(
  kind: ConstraintKind,
  keys: string[],
  values: Record<string, unknown>
): boolean {
  const present = keys.filter((key) => isMemberSet(values[key])).length;
  switch (kind) {
    case "exactly_one":
      return present === 1;
    case "at_least_one":
      return present >= 1;
    case "at_most_one":
      return present <= 1;
    case "none_or_all":
    case "all_or_none":
      return present === 0 || present === keys.length;
  }
  // Compile-time exhaustiveness: a new ConstraintKind makes `kind` non-never
  // here and fails the build. No runtime fallback — lockstep deployment means
  // only known kinds ever reach this.
  kind satisfies never;
}

/**
 * The schema paths (dotted keys, list indices dropped) of the members a
 * reactive banner or cluster speaks for: those a scope's ``required_groups``
 * name or that share an inclusive ``group``, at the root and in every nested
 * block. A list row's own members are left out, since a row paints no banner.
 * Paths, not entries: the form paints copies of board-locked entries.
 */
export function constraintMemberPaths(
  entries: ConfigEntry[],
  requiredGroups: RequiredGroup[],
  prefix: string[] = [],
  paintsBanner = true,
  out: Set<string> = new Set()
): Set<string> {
  const named = new Set(requiredGroups.flatMap((group) => group.keys));
  for (const entry of entries) {
    const path = [...prefix, entry.key];
    if (paintsBanner && (entry.group || named.has(entry.key))) out.add(path.join("."));
    const children = entry.config_entries;
    if (children?.length) {
      constraintMemberPaths(
        children,
        entry.required_groups ?? [],
        path,
        !entry.multi_value,
        out
      );
    }
  }
  return out;
}

/** *path* as ``constraintMemberPaths`` spells it: a row's index is not schema. */
export function schemaPathOf(path: string[]): string {
  return path.filter((segment) => !isIndexSegment(segment)).join(".");
}
