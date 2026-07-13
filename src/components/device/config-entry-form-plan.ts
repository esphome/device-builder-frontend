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
  /** Each cluster keyed by its first member's key — the slot it paints at. */
  clusterByFirstKey: Map<string, ConstraintCluster>;
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
  const clusterByFirstKey = new Map(clusters.map((c) => [c.members[0].key, c]));
  const nonExclusive = entries.filter(
    (entry) => !entry.exclusive_group && !memberKeys.has(entry.key)
  );
  const visible = new Set(filterRenderable(nonExclusive, values, opts));
  return { ordered, clusters, memberKeys, clusterByFirstKey, visible };
}

/**
 * Whether the plan paints anything the user can act on: an unlocked plain
 * field, an exclusive-group dropdown, or a cluster box with an unlocked member.
 *
 * A locked entry renders read-only ("Set by the board"), so a form whose only
 * fields — plain, grouped, or clustered — are locked is a dead-end screen. A
 * member is only counted when ``isVisible`` (the group/cluster member arrays are
 * unfiltered, so a hidden unlocked member — platform-incompatible, ``depends_on``
 * unmet — mustn't keep the form open). Lets a caller skip the form when every
 * input is fixed by the board.
 */
export function planNeedsUserInput(
  plan: FormRenderPlan,
  isVisible: (entry: ConfigEntry) => boolean
): boolean {
  const anyActionable = (entries: ConfigEntry[]): boolean =>
    entries.some((e) => !e.locked && isVisible(e));
  return (
    anyActionable([...plan.visible]) ||
    plan.clusters.some((cluster) => anyActionable(cluster.members)) ||
    plan.ordered.some((item) => Array.isArray(item) && anyActionable(item))
  );
}
