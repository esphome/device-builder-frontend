import type { ConfigEntry, RequiredGroup } from "../../api/types/config-entries.js";
import {
  filterRenderable,
  hasMaterialValue,
  type RenderFilterOptions,
} from "./config-entry-render-filter.js";
import {
  buildConstraintClusters,
  isRadioCluster,
  type ConstraintCluster,
} from "./config-entry-renderers/constraint-cluster.js";
import { choicePinned } from "../../util/config-entry-tree.js";
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

/** Every member advanced — an atomic unit can't straddle the boundary. */
export function unitAllAdvanced(members: ConfigEntry[]): boolean {
  return members.length > 0 && members.every((m) => !!m.advanced);
}

/** Any member valued — one value paints the whole unit inline. */
export function unitHasMaterialValue(
  members: ConfigEntry[],
  values: Record<string, unknown>
): boolean {
  return members.some((m) => hasMaterialValue(m, values));
}

/**
 * Per-key gate: whether the render unit (exclusive group / constraint
 * cluster) containing *key* is advanced-gated — every member advanced and
 * none valued — or undefined for keys outside any unit. Feeds
 * ``pathIsAdvanced`` so the caret-follow reveal can't drift from the
 * form's unit placement.
 */
export function unitAdvancedGate(
  entries: ConfigEntry[],
  requiredGroups: RequiredGroup[],
  values: Record<string, unknown>
): (key: string) => boolean | undefined {
  const memberFor = unitMembersByKey(entries, requiredGroups);
  return (key) => {
    const members = memberFor(key);
    if (!members) return undefined;
    return unitAllAdvanced(members) && !unitHasMaterialValue(members, values);
  };
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
  // A pinned selector (group dropdown, exactly_one radios) is disabled, so
  // an unlocked member behind it is unreachable — don't let it hold the
  // form open. Box clusters paint their members directly and stay gated on
  // anyActionable alone.
  return (
    anyActionable([...plan.visible]) ||
    plan.clusters.some(
      (cluster) =>
        anyActionable(cluster.members) &&
        !(isRadioCluster(cluster) && choicePinned(cluster.members, isVisible))
    ) ||
    plan.ordered.some(
      (item) =>
        Array.isArray(item) && anyActionable(item) && !choicePinned(item, isVisible)
    )
  );
}

function unitMembersByKey(
  entries: ConfigEntry[],
  requiredGroups: RequiredGroup[]
): (key: string) => ConfigEntry[] | undefined {
  const byKey = new Map<string, ConfigEntry[]>();
  const { clusters } = buildConstraintClusters(entries, requiredGroups);
  for (const cluster of clusters) {
    for (const member of cluster.members) byKey.set(member.key, cluster.members);
  }
  const groups = new Map<string, ConfigEntry[]>();
  for (const entry of entries) {
    if (!entry.exclusive_group) continue;
    // Every member shares one array, so earlier keys see later joiners.
    const members = groups.get(entry.exclusive_group) ?? [];
    members.push(entry);
    groups.set(entry.exclusive_group, members);
    byKey.set(entry.key, members);
  }
  return (key) => byKey.get(key);
}
