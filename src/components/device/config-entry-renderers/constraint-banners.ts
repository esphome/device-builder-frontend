import type { ConfigEntry, RequiredGroup } from "../../../api/types/config-entries.js";
import { isEntryVisible } from "../../../util/config-validation.js";
import { type ConstraintKind, evaluateGroup } from "../../../util/constraint-groups.js";
import { getIn } from "../../../util/nested-values.js";

/** Inputs for the fallback constraint-banner pass. */
export interface ConstraintBannerInputs {
  entries: ConfigEntry[];
  requiredGroups: RequiredGroup[];
  values: Record<string, unknown>;
  presentComponents: ReadonlySet<string>;
  targetPlatform: string | null;
  /** The component-root values, so a nested member's ``depends_on`` on a
   *  top-level field resolves as it does in the paint. */
  rootValues?: Record<string, unknown>;
}

/** An unsatisfied constraint to surface as a banner: the prompt's ``kind``
 *  (mapped to ``device.constraint_${kind}`` by the host) plus the keys it
 *  names for the ``{keys}`` placeholder. */
export interface UnsatisfiedConstraint {
  kind: ConstraintKind;
  keys: string[];
}

/**
 * Collect the fallback banners for *unsatisfied* constraint groups that aren't
 * visually clustered (pure cardinality groups with no inclusive `group`, plus
 * the residual inclusive group whose members are all also exclusive_group
 * members). Groups whose members render inside a `constraint-cluster` box are
 * skipped via ``clusteredKeys`` — the box header already carries their prompt.
 */
export function collectUnsatisfiedConstraints(
  inputs: ConstraintBannerInputs,
  clusteredKeys: ReadonlySet<string>
): UnsatisfiedConstraint[] {
  const {
    entries,
    requiredGroups,
    values,
    presentComponents,
    targetPlatform,
    rootValues,
  } = inputs;
  // Most scopes carry neither kind of constraint.
  if (requiredGroups.length === 0 && !entries.some((e) => e.group)) return [];
  const messages: UnsatisfiedConstraint[] = [];
  // Skip a banner when none of its members currently render (gated off by
  // hidden / depends_on / platform, or simply not a rendered entry), matching
  // the cluster box — otherwise the prompt nags about fields the user can't set.
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const keyVisible = (k: string): boolean => {
    const entry = byKey.get(k);
    return (
      entry !== undefined &&
      (getIn(values, [k]) !== undefined ||
        isEntryVisible(
          entry,
          values,
          presentComponents,
          targetPlatform,
          rootValues,
          entries
        ))
    );
  };
  const anyVisible = (keys: string[]): boolean => keys.some(keyVisible);
  // The all/none kinds exist to name the *missing* member, visible or
  // not, so they keep every key; the rest prompt the user to set (or
  // unset) something, so they name only keys the user can see — a
  // hidden alias shouldn't be prompted for.
  const namedKeys = (kind: ConstraintKind, keys: string[]): string[] =>
    kind === "all_or_none" || kind === "none_or_all" ? keys : keys.filter(keyVisible);
  for (const group of requiredGroups) {
    if (group.keys.some((k) => clusteredKeys.has(k))) continue;
    if (!anyVisible(group.keys)) continue;
    if (evaluateGroup(group.kind, group.keys, values)) continue;
    messages.push({ kind: group.kind, keys: namedKeys(group.kind, group.keys) });
  }
  // At the form root buildConstraintClusters folds every *non-exclusive*
  // inclusive group into a cluster (its members land in clusteredKeys), so
  // this loop only fires there for the residual case it skips: an inclusive
  // group whose members are all also exclusive_group members. A nested scope
  // paints no clusters, so there it carries every inclusive group. The
  // collection is deliberately broad (entry.group, no !exclusive_group guard).
  const inclusive = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.group) {
      inclusive.set(entry.group, [...(inclusive.get(entry.group) ?? []), entry.key]);
    }
  }
  for (const keys of inclusive.values()) {
    if (keys.some((k) => clusteredKeys.has(k))) continue;
    if (!anyVisible(keys)) continue;
    if (evaluateGroup("all_or_none", keys, values)) continue;
    // No-op for this loop's fixed kind; routed through so the naming
    // rule lives in one place.
    messages.push({ kind: "all_or_none", keys: namedKeys("all_or_none", keys) });
  }
  return messages;
}
