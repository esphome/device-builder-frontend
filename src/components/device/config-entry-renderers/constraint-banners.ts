import type { ConfigEntry, RequiredGroup } from "../../../api/types/config-entries.js";
import { isEntryVisible } from "../../../util/config-validation.js";
import { type ConstraintKind, evaluateGroup } from "../../../util/constraint-groups.js";
import { getIn } from "../../../util/nested-values.js";

/** Inputs for the fallback constraint-banner pass. ``formatKeys`` is injected
 *  (rather than passing a renderer ctx) so this module stays DOM/localize-free
 *  and unit-testable; the host wraps ``formatConstraintKeys(keys, entries, ctx)``. */
export interface ConstraintBannerInputs {
  entries: ConfigEntry[];
  requiredGroups: RequiredGroup[];
  values: Record<string, unknown>;
  presentComponents: ReadonlySet<string>;
  targetPlatform: string | null;
  formatKeys: (keys: string[]) => string;
}

/** An unsatisfied constraint to surface as a banner: the prompt's ``kind``
 *  (mapped to ``device.constraint_${kind}`` by the host) plus the formatted
 *  key list for the ``{keys}`` placeholder. */
export interface UnsatisfiedConstraint {
  kind: ConstraintKind;
  keys: string;
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
  clusteredKeys: Set<string>
): UnsatisfiedConstraint[] {
  const {
    entries,
    requiredGroups,
    values,
    presentComponents,
    targetPlatform,
    formatKeys,
  } = inputs;
  const messages: UnsatisfiedConstraint[] = [];
  // Skip a banner when none of its members currently render (gated off by
  // hidden / depends_on / platform, or simply not a rendered entry), matching
  // the cluster box — otherwise the prompt nags about fields the user can't set.
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const anyVisible = (keys: string[]): boolean =>
    keys.some((k) => {
      const entry = byKey.get(k);
      return (
        entry !== undefined &&
        (getIn(values, [k]) !== undefined ||
          isEntryVisible(entry, values, presentComponents, targetPlatform))
      );
    });
  for (const group of requiredGroups) {
    if (group.keys.some((k) => clusteredKeys.has(k))) continue;
    if (!anyVisible(group.keys)) continue;
    if (evaluateGroup(group.kind, group.keys, values)) continue;
    messages.push({ kind: group.kind, keys: formatKeys(group.keys) });
  }
  // buildConstraintClusters folds every *non-exclusive* inclusive group into
  // a cluster (whose members land in clusteredKeys), so this loop only fires
  // for the residual case it skips: an inclusive group whose members are all
  // also exclusive_group members. The collection here is deliberately broader
  // (entry.group, no !exclusive_group guard) to still surface that banner.
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
    messages.push({ kind: "all_or_none", keys: formatKeys(keys) });
  }
  return messages;
}
