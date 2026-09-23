import { html, nothing } from "lit";
import type { ConfigEntry, RequiredGroup } from "../../../api/types/config-entries.js";
import { choicePinned } from "../../../util/config-entry-tree.js";
import { isEntryVisible } from "../../../util/config-validation.js";
import {
  type ConstraintKind,
  evaluateGroup,
  isMemberSet,
} from "../../../util/constraint-groups.js";
import { isEmptyBlock, type RenderFilterOptions } from "../config-entry-render-filter.js";
import {
  fieldKeyAttr,
  labelFor,
  type RenderCtx,
} from "../config-entry-renderers-shared.js";

/** An either/or constraint rendered as one bordered box: an inclusive
 *  all-or-none `group` (the timings), plus any cardinality group that picks
 *  between it and a sibling (chipset). */
export interface ConstraintCluster {
  /** Member entries in catalog order (the cardinality alternatives + the
   *  inclusive group's fields). */
  members: ConfigEntry[];
  /** The `required_groups` entry whose keys pick among the alternatives. */
  cardinality?: RequiredGroup;
  /** The inclusive all-or-none member keys. */
  inclusiveKeys: string[];
}

/**
 * Group constraint fields that should render together: seed a cluster from
 * each inclusive `group` id, then absorb any `required_groups` entry that
 * references one of its members (pulling that group's other members in, e.g.
 * `chipset`). Only inclusive-involving constraints cluster; pure cardinality
 * groups stay in the flow and surface through the banner instead.
 */
export function buildConstraintClusters(
  entries: ConfigEntry[],
  requiredGroups: RequiredGroup[]
): { clusters: ConstraintCluster[]; memberKeys: Set<string> } {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const inclusive = new Map<string, string[]>();
  for (const entry of entries) {
    // exclusive_group members own their pick-one dropdown; never re-cluster.
    if (entry.group && !entry.exclusive_group) {
      inclusive.set(entry.group, [...(inclusive.get(entry.group) ?? []), entry.key]);
    }
  }
  const clusters: ConstraintCluster[] = [];
  const memberKeys = new Set<string>();
  for (const inclusiveKeys of inclusive.values()) {
    const keys = new Set(inclusiveKeys);
    const cardinality = requiredGroups.find((g) => g.keys.some((k) => keys.has(k)));
    if (cardinality) {
      for (const key of cardinality.keys) {
        if (!byKey.get(key)?.exclusive_group) keys.add(key);
      }
    }
    const members = entries.filter((e) => keys.has(e.key));
    members.forEach((m) => memberKeys.add(m.key));
    // A cardinality (radio) needs >= 2 alternatives that resolve to a rendered
    // member; when one is preset/hidden — a featured component locks chipset and
    // drops it from the form — keep just the inclusive all-or-none box rather
    // than a one-option radio.
    const resolved = cardinality
      ? cardinality.keys.filter((k) => members.some((m) => m.key === k)).length
      : 0;
    clusters.push({
      members,
      cardinality: resolved >= 2 ? cardinality : undefined,
      inclusiveKeys,
    });
  }
  return { clusters, memberKeys };
}

/** Format a key list for a constraint prompt, collapsing an inclusive `group`
 *  member into its whole set: `chipset, (Bit0 High, Bit0 Low, …)`. Shared so
 *  the cluster header and the fallback banner read identically. */
export function formatConstraintKeys(
  keys: string[],
  entries: ConfigEntry[],
  ctx: RenderCtx
): string {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const labelOf = (key: string): string => {
    const entry = byKey.get(key);
    return entry ? labelFor(entry, ctx) : key;
  };
  // Collapse every key of one inclusive group to a single parenthesized set,
  // emitted once: two keys sharing a group (mqtt's cert + key) must not name
  // the pair twice.
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const key of keys) {
    const group = byKey.get(key)?.group;
    if (!group) {
      parts.push(labelOf(key));
      continue;
    }
    if (seen.has(group)) continue;
    seen.add(group);
    const labels = entries.filter((e) => e.group === group).map((e) => labelOf(e.key));
    parts.push(labels.length > 1 ? `(${labels.join(", ")})` : labels[0]);
  }
  return parts.join(", ");
}

/** An either/or choice within a cluster: a single scalar (`chipset`) or a
 *  whole inclusive group (the four timings) the user picks between. */
export interface ClusterAlternative {
  /** Stable radio value — the alternative's first member key. */
  id: string;
  members: ConfigEntry[];
}

/** A `ClusterAlternative` with its radio label. */
export interface LabelledClusterAlternative extends ClusterAlternative {
  label: string;
}

/** How one cluster paints under a value map: its members on screen, the
 *  chooser shape, and the rule its header warns about. */
export interface ClusterPaint {
  cluster: ConstraintCluster;
  /** Members the box (or a picked radio side) paints. */
  painted: ConfigEntry[];
  /** `radio` needs two paintable alternatives; `none` paints nothing. */
  mode: "radio" | "box" | "none";
  /** The rule the header leads with while unmet: cardinality, then all-or-none. */
  unmet: { kind: ConstraintKind; keys: string[] } | null;
}

/** `exactly_one` clusters render as a radio chooser (only the picked side's
 *  fields show); every other cluster stays a static box. */
export function isRadioCluster(cluster: ConstraintCluster): boolean {
  return cluster.cardinality?.kind === "exactly_one";
}

/** One alternative per cardinality key: a key heading an inclusive `group`
 *  expands to that group's members; a bare key is its own single-member
 *  alternative. */
export function clusterAlternatives(cluster: ConstraintCluster): ClusterAlternative[] {
  const byKey = new Map(cluster.members.map((m) => [m.key, m]));
  return (cluster.cardinality?.keys ?? []).flatMap((key) => {
    const entry = byKey.get(key);
    if (!entry) return [];
    const members = entry.group
      ? cluster.members.filter((m) => m.group === entry.group)
      : [entry];
    return [{ id: members[0].key, members }];
  });
}

/** `clusterAlternatives` with each radio's label (member labels joined). */
export function buildAlternatives(
  cluster: ConstraintCluster,
  ctx: RenderCtx
): LabelledClusterAlternative[] {
  return clusterAlternatives(cluster).map((alt) => ({
    ...alt,
    label: alt.members.map((m) => labelFor(m, ctx)).join(", "),
  }));
}

/** A member paints when it holds a value or is visible, unless it is a
 *  block with nothing in it. */
function clusterMemberPainted(
  member: ConfigEntry,
  values: Record<string, unknown>,
  opts: RenderFilterOptions,
  entries: ConfigEntry[]
): boolean {
  const shown =
    values[member.key] !== undefined ||
    isEntryVisible(
      member,
      values,
      opts.presentComponents,
      opts.targetPlatform ?? null,
      opts.rootValues,
      entries
    );
  return shown && !isEmptyBlock(member, values, opts);
}

/**
 * Decide how *cluster* paints under *values*. A radio needs two alternatives
 * with a painted member (a board / platform / depends_on can hide a side at
 * runtime); with fewer it paints as the static box.
 */
export function planCluster(
  cluster: ConstraintCluster,
  values: Record<string, unknown>,
  opts: RenderFilterOptions,
  entries: ConfigEntry[]
): ClusterPaint {
  const painted = cluster.members.filter((m) =>
    clusterMemberPainted(m, values, opts, entries)
  );
  const paintedSet = new Set(painted);
  const radio =
    isRadioCluster(cluster) &&
    clusterAlternatives(cluster).filter((a) => a.members.some((m) => paintedSet.has(m)))
      .length >= 2;
  const mode = painted.length === 0 ? "none" : radio ? "radio" : "box";
  return { cluster, painted, mode, unmet: clusterUnmetRule(cluster, values) };
}

/** The rule a cluster's header leads with while unmet, or null once both hold. */
function clusterUnmetRule(
  cluster: ConstraintCluster,
  values: Record<string, unknown>
): ClusterPaint["unmet"] {
  const { cardinality, inclusiveKeys } = cluster;
  if (cardinality && !evaluateGroup(cardinality.kind, cardinality.keys, values)) {
    return { kind: cardinality.kind, keys: cardinality.keys };
  }
  if (!evaluateGroup("all_or_none", inclusiveKeys, values)) {
    return { kind: "all_or_none", keys: inclusiveKeys };
  }
  return null;
}

/** Switch the cluster's active alternative: stash + drop every other side's
 *  present values (so only the selected side reaches YAML), then restore any
 *  values previously stashed for the chosen side. */
export function selectClusterAlternative(
  cluster: ConstraintCluster,
  ctx: RenderCtx,
  newAltId: string
): void {
  const clusterId = cluster.members[0].key;
  const alternatives = buildAlternatives(cluster, ctx);
  const chosen = alternatives.find((a) => a.id === newAltId);
  if (!chosen) return;
  for (const alt of alternatives) {
    if (alt.id === newAltId) continue;
    for (const { key } of alt.members) {
      const value = ctx.getAt([key]);
      if (value !== undefined) {
        ctx.setClusterStash(clusterId, key, value);
        ctx.emitChange([key], undefined);
      }
    }
  }
  for (const { key } of chosen.members) {
    const stashed = ctx.getClusterStash(clusterId, key);
    if (stashed !== undefined) {
      ctx.emitChange([key], stashed);
      ctx.clearClusterStash(clusterId, key);
    }
  }
  ctx.setClusterChoice(clusterId, newAltId);
}

/** Paint one cluster as its plan decided: nothing, a radio chooser, or a box. */
export function renderConstraintCluster(paint: ClusterPaint, ctx: RenderCtx) {
  switch (paint.mode) {
    case "none":
      return nothing;
    case "radio":
      return renderConstraintRadioField(paint, ctx);
    case "box":
      return renderConstraintClusterField(paint, ctx);
  }
}

/** Render an `exactly_one` cluster as a radio chooser: a muted prompt, a radio
 *  per alternative, and only the selected alternative's fields. The radio
 *  enforces the choice and only the picked side is ever saved, so there is no
 *  unsatisfied/warning state. */
export function renderConstraintRadioField(paint: ClusterPaint, ctx: RenderCtx) {
  const { cluster } = paint;
  const clusterId = cluster.members[0].key;
  const painted = new Set(paint.painted);
  const isRenderable = (m: ConfigEntry): boolean => painted.has(m);

  const alternatives = buildAlternatives(cluster, ctx).filter((a) =>
    a.members.some(isRenderable)
  );

  // Stored choice wins; else infer from whichever side already holds a value
  // (round-trips existing YAML); else nothing selected yet.
  const selectedId =
    ctx.getClusterChoice(clusterId) ??
    alternatives.find((a) => a.members.some((m) => isMemberSet(ctx.getAt([m.key]))))?.id;
  const selected = alternatives.find((a) => a.id === selectedId);

  // The radios below name each alternative, so the header drops the key list
  // and reads as a bare prompt.
  const message = ctx.localize("device.constraint_exactly_one_radio");
  const headerId = `constraint-cluster-${clusterId}`;

  const visibleMembers = (selected?.members ?? []).filter(isRenderable);
  // A board-locked member means the board made the cluster choice; switching
  // sides would clear the locked value, so the radios pin to it. Gated on
  // renderable members, matching the dropdown's options and the plan gate.
  const pinned = choicePinned(
    alternatives.flatMap((a) => a.members),
    isRenderable
  );
  return html`
    <div
      class="nested-group constraint-cluster"
      data-field-key=${fieldKeyAttr([clusterId])}
    >
      <div id=${headerId} class="constraint-cluster-header">
        <span>${message}</span>
      </div>
      <wa-radio-group
        class="constraint-cluster-radios"
        aria-labelledby=${headerId}
        .value=${selectedId ?? ""}
        ?disabled=${ctx.disabled || pinned}
        @change=${(e: Event) =>
          selectClusterAlternative(
            cluster,
            ctx,
            (e.target as unknown as { value: string }).value
          )}
      >
        ${alternatives.map((a) => html`<wa-radio value=${a.id}>${a.label}</wa-radio>`)}
      </wa-radio-group>
      ${
        visibleMembers.length
          ? html`<div class="nested-fields">
              ${visibleMembers.map((m) => ctx.renderEntry(m, [m.key]))}
            </div>`
          : nothing
      }
    </div>
  `;
}

/** Render one cluster as a bordered `.nested-group` box: a reactive
 *  constraint header (warning until satisfied) over its member fields. */
export function renderConstraintClusterField(paint: ClusterPaint, ctx: RenderCtx) {
  const { cluster, painted, unmet } = paint;
  // Once both rules hold, keep the cardinality summary as a muted caption so
  // the grouping stays legible.
  const prompt = unmet ?? {
    kind: cluster.cardinality?.kind ?? "all_or_none",
    keys: cluster.cardinality?.keys ?? cluster.inclusiveKeys,
  };
  const message = ctx.localize(`device.constraint_${prompt.kind}`, {
    // Resolve labels against the full entry set so a cardinality key dropped
    // from members (also an exclusive_group member) still localizes.
    keys: formatConstraintKeys(prompt.keys, ctx.entries, ctx),
  });

  // All members gated off (depends_on / platform / hidden): skip the box rather
  // than render an empty bordered card with just a header.
  if (!painted.length) return nothing;
  return html`
    <div
      class="nested-group constraint-cluster"
      data-field-key=${fieldKeyAttr([cluster.members[0].key])}
    >
      <div class="constraint-cluster-header ${unmet ? "unsatisfied" : ""}">
        ${unmet ? html`<wa-icon library="mdi" name="alert-circle-outline"></wa-icon>` : nothing}
        <span>${message}</span>
      </div>
      <div class="nested-fields">${painted.map((m) => ctx.renderEntry(m, [m.key]))}</div>
    </div>
  `;
}
