import type { ConfigEntry, RequiredGroup } from "../../api/types/config-entries.js";
import { choicePinned } from "../../util/config-entry-tree.js";
import type { ConstraintKind } from "../../util/constraint-groups.js";
import { hasMaterialValue } from "../../util/material-value.js";
import {
  filterRenderable,
  type RenderFilterOptions,
} from "./config-entry-render-filter.js";
import { collectUnsatisfiedConstraints } from "./config-entry-renderers/constraint-banners.js";
import {
  buildConstraintClusters,
  type ClusterPaint,
  planCluster,
} from "./config-entry-renderers/constraint-cluster.js";
import {
  type ExclusiveGroupPaint,
  orderExclusiveGroups,
  planExclusiveGroup,
} from "./config-entry-renderers/exclusive-group.js";

/** A constraint the paint reports unmet. */
export interface UnmetConstraint {
  kind: ConstraintKind;
  /** The keys the prompt names. */
  keys: string[];
  /** The paint carrying the prompt. */
  source: "banner" | "cluster";
  /** The paint offers an unlocked member the user can set. */
  actionable: boolean;
}

/**
 * The structural decision `ESPHomeConfigEntryForm.render()` makes before
 * emitting templates: which entries fold into exclusive-group dropdowns or
 * constraint-cluster boxes, which plain entries survive the visibility
 * filter, and which constraints are unmet. Extracted so render() and the
 * add-component dialog's gates agree on what the form paints.
 */
export interface FormRenderPlan {
  /** Entries in paint order; an array element is one exclusive group. */
  ordered: (ConfigEntry | ConfigEntry[])[];
  /** Either/or constraint clusters, each with its paint decision. */
  clusters: ClusterPaint[];
  /** Keys folded into a cluster, dropped from the normal flow. */
  memberKeys: Set<string>;
  /** Each cluster keyed by its first member's key — the slot it paints at. */
  clusterByFirstKey: Map<string, ClusterPaint>;
  /** Each exclusive group's paint, keyed by its member array in `ordered`. */
  groupPaints: Map<ConfigEntry[], ExclusiveGroupPaint>;
  /** Plain (non-exclusive, non-cluster) entries that pass the filter. */
  visible: Set<ConfigEntry>;
  /** The painted entries the user can set (unlocked, not behind a pinned
   *  selector), keyed by entry key. */
  settable: Map<string, ConfigEntry>;
  /** Unmet constraints, banners first, then cluster headers. */
  unmet: UnmetConstraint[];
}

export function buildFormRenderPlan(
  entries: ConfigEntry[],
  values: Record<string, unknown>,
  requiredGroups: RequiredGroup[],
  opts: RenderFilterOptions
): FormRenderPlan {
  const scoped = { ...opts, requiredGroups };
  const ordered = orderExclusiveGroups(entries);
  const { clusters: built, memberKeys } = buildConstraintClusters(
    entries,
    requiredGroups
  );
  const clusters = built.map((c) => planCluster(c, values, scoped, entries));
  const clusterByFirstKey = new Map(clusters.map((c) => [c.cluster.members[0].key, c]));
  const groups = ordered
    .filter((item): item is ConfigEntry[] => Array.isArray(item))
    .map((members) => planExclusiveGroup(members, values, scoped, entries));
  const groupPaints = new Map(groups.map((g) => [g.members, g]));
  const nonExclusive = entries.filter(
    (entry) => !entry.exclusive_group && !memberKeys.has(entry.key)
  );
  const visible = new Set(filterRenderable(nonExclusive, values, scoped));

  // A pinned selector (group dropdown, exactly_one radios) is disabled, so an
  // unlocked member behind it is unreachable.
  const settable = new Map<string, ConfigEntry>();
  const offer = (members: ConfigEntry[]): void => {
    for (const m of members) if (!m.locked) settable.set(m.key, m);
  };
  offer([...visible]);
  for (const { painted, mode } of clusters) {
    if (!(mode === "radio" && choicePinned(painted))) offer(painted);
  }
  for (const { options } of groups) if (!choicePinned(options)) offer(options);

  const unmet: UnmetConstraint[] = collectUnsatisfiedConstraints(
    { entries, requiredGroups, values, opts: scoped },
    memberKeys
  ).map(({ kind, keys }) => ({
    kind,
    keys,
    source: "banner",
    actionable: keys.some((key) => settable.has(key)),
  }));
  for (const { painted, unmet: rule } of clusters) {
    if (!rule) continue;
    unmet.push({
      ...rule,
      source: "cluster",
      actionable: painted.some((m) => settable.get(m.key) === m),
    });
  }
  return {
    ordered,
    clusters,
    memberKeys,
    clusterByFirstKey,
    groupPaints,
    visible,
    settable,
    unmet,
  };
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
 * Whether the plan paints anything the user can act on. A locked entry
 * renders read-only ("Set by the board"), so a form whose only fields are
 * locked is a dead-end screen a caller can skip.
 */
export function planNeedsUserInput(plan: FormRenderPlan): boolean {
  return plan.settable.size > 0;
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
