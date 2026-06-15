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
import type { RequiredGroupKind } from "../api/types/config-entries.js";
import { isValuePresent } from "./config-validation.js";

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

/** Does the cardinality constraint *kind* hold over *keys* in *values*? */
export function evaluateGroup(
  kind: ConstraintKind,
  keys: string[],
  values: Record<string, unknown>
): boolean {
  const present = keys.filter((key) => isValuePresent(values[key])).length;
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
