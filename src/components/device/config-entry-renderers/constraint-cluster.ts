import { html, nothing } from "lit";
import type { ConfigEntry, RequiredGroup } from "../../../api/types/config-entries.js";
import { isEntryVisible, isValuePresent } from "../../../util/config-validation.js";
import { evaluateGroup } from "../../../util/constraint-groups.js";
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
  label: string;
}

/** `exactly_one` clusters render as a radio chooser (only the picked side's
 *  fields show); every other cluster stays a static box. */
export function isRadioCluster(cluster: ConstraintCluster): boolean {
  return cluster.cardinality?.kind === "exactly_one";
}

/** One alternative per cardinality key: a key heading an inclusive `group`
 *  expands to that group's members (label = member labels joined); a bare key
 *  is its own single-member alternative. */
export function buildAlternatives(
  cluster: ConstraintCluster,
  ctx: RenderCtx
): ClusterAlternative[] {
  const byKey = new Map(cluster.members.map((m) => [m.key, m]));
  return (cluster.cardinality?.keys ?? []).flatMap((key) => {
    const entry = byKey.get(key);
    if (!entry) return [];
    const members = entry.group
      ? cluster.members.filter((m) => m.group === entry.group)
      : [entry];
    return [
      {
        id: members[0].key,
        members,
        label: members.map((m) => labelFor(m, ctx)).join(", "),
      },
    ];
  });
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

/** Render an `exactly_one` cluster as a radio chooser: a muted prompt, a radio
 *  per alternative, and only the selected alternative's fields. The radio
 *  enforces the choice and only the picked side is ever saved, so there is no
 *  unsatisfied/warning state. */
export function renderConstraintRadioField(cluster: ConstraintCluster, ctx: RenderCtx) {
  const clusterId = cluster.members[0].key;
  const values = ctx.scopeValues([]);
  const targetPlatform = ctx.board?.esphome.platform ?? null;
  const isRenderable = (m: ConfigEntry): boolean =>
    ctx.getAt([m.key]) !== undefined ||
    isEntryVisible(m, values, ctx.presentComponents, targetPlatform);

  // Gate alternatives on renderability (a board / platform / depends_on can hide
  // a side at runtime) and fall back to the static box when fewer than two real
  // choices remain, mirroring exclusive_group's option gating.
  const alternatives = buildAlternatives(cluster, ctx).filter((a) =>
    a.members.some(isRenderable)
  );
  if (alternatives.length < 2) return renderConstraintClusterField(cluster, ctx);

  // Stored choice wins; else infer from whichever side already holds a value
  // (round-trips existing YAML); else nothing selected yet.
  const selectedId =
    ctx.getClusterChoice(clusterId) ??
    alternatives.find((a) => a.members.some((m) => isValuePresent(ctx.getAt([m.key]))))
      ?.id;
  const selected = alternatives.find((a) => a.id === selectedId);

  // The radios below name each alternative, so the header drops the key list
  // and reads as a bare prompt.
  const message = ctx.localize("device.constraint_exactly_one_radio");
  const headerId = `constraint-cluster-${clusterId}`;

  const visibleMembers = (selected?.members ?? []).filter(isRenderable);
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
        ?disabled=${ctx.disabled}
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
export function renderConstraintClusterField(cluster: ConstraintCluster, ctx: RenderCtx) {
  const values = ctx.scopeValues([]);
  const targetPlatform = ctx.board?.esphome.platform ?? null;
  const cardinalityOk = cluster.cardinality
    ? evaluateGroup(cluster.cardinality.kind, cluster.cardinality.keys, values)
    : true;
  const inclusiveOk = evaluateGroup("all_or_none", cluster.inclusiveKeys, values);

  // Lead with whichever rule is currently unmet; once both hold, keep the
  // cardinality summary as a muted caption so the grouping stays legible.
  const prompt =
    !cardinalityOk && cluster.cardinality
      ? {
          kind: cluster.cardinality.kind,
          keys: cluster.cardinality.keys,
          satisfied: false,
        }
      : !inclusiveOk
        ? { kind: "all_or_none" as const, keys: cluster.inclusiveKeys, satisfied: false }
        : {
            kind: cluster.cardinality?.kind ?? "all_or_none",
            keys: cluster.cardinality?.keys ?? cluster.inclusiveKeys,
            satisfied: true,
          };
  const message = ctx.localize(`device.constraint_${prompt.kind}`, {
    // Resolve labels against the full entry set so a cardinality key dropped
    // from members (also an exclusive_group member) still localizes.
    keys: formatConstraintKeys(prompt.keys, ctx.entries ?? cluster.members, ctx),
  });

  const visibleMembers = cluster.members.filter(
    (m) =>
      ctx.getAt([m.key]) !== undefined ||
      isEntryVisible(m, values, ctx.presentComponents, targetPlatform)
  );
  // All members gated off (depends_on / platform / hidden): skip the box rather
  // than render an empty bordered card with just a header.
  if (!visibleMembers.length) return nothing;
  return html`
    <div
      class="nested-group constraint-cluster"
      data-field-key=${fieldKeyAttr([cluster.members[0].key])}
    >
      <div class="constraint-cluster-header ${prompt.satisfied ? "" : "unsatisfied"}">
        ${
          prompt.satisfied
            ? nothing
            : html`<wa-icon library="mdi" name="alert-circle-outline"></wa-icon>`
        }
        <span>${message}</span>
      </div>
      <div class="nested-fields">
        ${visibleMembers.map((m) => ctx.renderEntry(m, [m.key]))}
      </div>
    </div>
  `;
}
