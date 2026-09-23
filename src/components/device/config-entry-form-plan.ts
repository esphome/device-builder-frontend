import {
  type ConfigEntry,
  ConfigEntryType,
  type RequiredGroup,
} from "../../api/types/config-entries.js";
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
  exclusiveOptions,
  orderExclusiveGroups,
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
  /** Plain (non-exclusive, non-cluster) entries that pass the filter. */
  visible: Set<ConfigEntry>;
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
  const built = buildConstraintClusters(entries, requiredGroups);
  const clusters = built.clusters.map((c) => planCluster(c, values, scoped, entries));
  const memberKeys = built.memberKeys;
  const clusterByFirstKey = new Map(clusters.map((c) => [c.cluster.members[0].key, c]));
  const nonExclusive = entries.filter(
    (entry) => !entry.exclusive_group && !memberKeys.has(entry.key)
  );
  const visible = new Set(filterRenderable(nonExclusive, values, scoped));

  // Every key the root paint puts on screen, for banner actionability.
  const paintedKeys = new Set([...visible].map((e) => e.key));
  for (const paint of clusters) paint.painted.forEach((m) => paintedKeys.add(m.key));
  for (const item of ordered) {
    if (!Array.isArray(item)) continue;
    exclusiveOptions(item, values, scoped, entries).forEach((m) =>
      paintedKeys.add(m.key)
    );
  }
  const locked = new Set(entries.filter((e) => e.locked).map((e) => e.key));
  const unmet: UnmetConstraint[] = collectUnsatisfiedConstraints(
    {
      entries,
      requiredGroups,
      values,
      presentComponents: opts.presentComponents ?? new Set(),
      targetPlatform: opts.targetPlatform ?? null,
      rootValues: opts.rootValues,
    },
    memberKeys
  ).map(({ kind, keys }) => ({
    kind,
    keys,
    source: "banner",
    actionable: keys.some((key) => paintedKeys.has(key) && !locked.has(key)),
  }));
  for (const { cluster, painted, mode, unmet: rule } of clusters) {
    if (mode === "none" || !rule) continue;
    // A radio paints no warning and forces the choice, but picking a side
    // does not switch a block on, so a radio with a block side still counts.
    const hasBlock = cluster.members.some((m) => m.type === ConfigEntryType.NESTED);
    if (mode === "radio" && !hasBlock) continue;
    unmet.push({
      ...rule,
      source: "cluster",
      actionable: hasActionableEntry(painted, () => true),
    });
  }
  return { ordered, clusters, memberKeys, clusterByFirstKey, visible, unmet };
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

/** Whether any of *entries* is one the user can set: unlocked and visible. */
export function hasActionableEntry(
  entries: ConfigEntry[],
  isVisible: (entry: ConfigEntry) => boolean
): boolean {
  return entries.some((entry) => !entry.locked && isVisible(entry));
}

/**
 * Whether the plan paints anything the user can act on: an unlocked plain
 * field, an exclusive-group dropdown, or a cluster box with an unlocked member.
 *
 * A locked entry renders read-only ("Set by the board"), so a form whose only
 * fields — plain, grouped, or clustered — are locked is a dead-end screen. An
 * exclusive-group member is only counted when ``isVisible`` (the group arrays
 * are unfiltered, so a hidden unlocked member — platform-incompatible,
 * ``depends_on`` unmet — mustn't keep the form open). Lets a caller skip the
 * form when every input is fixed by the board.
 */
export function planNeedsUserInput(
  plan: FormRenderPlan,
  isVisible: (entry: ConfigEntry) => boolean
): boolean {
  const anyActionable = (entries: ConfigEntry[]): boolean =>
    hasActionableEntry(entries, isVisible);
  // A pinned selector (group dropdown, exactly_one radios) is disabled, so
  // an unlocked member behind it is unreachable — don't let it hold the
  // form open. Box clusters paint their members directly and stay gated on
  // anyActionable alone.
  return (
    anyActionable([...plan.visible]) ||
    plan.clusters.some(
      ({ painted, mode }) =>
        hasActionableEntry(painted, () => true) &&
        !(mode === "radio" && choicePinned(painted))
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
