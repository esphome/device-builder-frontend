import type { ConfigEntry, RequiredGroup } from "../../api/types/config-entries.js";
import {
  filterRenderable,
  type RenderFilterOptions,
} from "./config-entry-render-filter.js";
import {
  buildConstraintClusters,
  type ConstraintCluster,
} from "./config-entry-renderers/constraint-cluster.js";
import { orderExclusiveGroups } from "./config-entry-renderers/exclusive-group.js";

/**
 * The structural decision `ESPHomeConfigEntryForm.render()` makes before
 * emitting templates: which entries fold into exclusive-group dropdowns or
 * constraint-cluster boxes, and which plain entries survive the visibility
 * filter. Extracted so render() and the add-component dialog's empty-form
 * gate agree on what the form paints (constraint banners are separate — they
 * render only for *unsatisfied* groups; see ``collectUnsatisfiedConstraints``).
 */
export interface FormRenderPlan {
  /** Entries in paint order; an array element is one exclusive group. */
  ordered: (ConfigEntry | ConfigEntry[])[];
  /** Either/or constraint clusters, each rendered as one bordered box. */
  clusters: ConstraintCluster[];
  /** Keys folded into a cluster, dropped from the normal flow. */
  memberKeys: Set<string>;
  /** Plain (non-exclusive, non-cluster) entries that pass the filter. */
  visible: Set<ConfigEntry>;
}

export function buildFormRenderPlan(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
  requiredGroups: RequiredGroup[],
  opts: RenderFilterOptions
): FormRenderPlan {
  const ordered = orderExclusiveGroups(entries);
  const { clusters, memberKeys } = buildConstraintClusters(entries, requiredGroups);
  const nonExclusive = entries.filter(
    (entry) => !entry.exclusive_group && !memberKeys.has(entry.key)
  );
  const visible = new Set(filterRenderable(nonExclusive, values, opts));
  return { ordered, clusters, memberKeys, visible };
}

/** Whether the plan paints any field, exclusive-group dropdown, or cluster box. */
export function planRendersContent(plan: FormRenderPlan): boolean {
  return (
    plan.visible.size > 0 ||
    plan.clusters.length > 0 ||
    plan.ordered.some((item) => Array.isArray(item))
  );
}
