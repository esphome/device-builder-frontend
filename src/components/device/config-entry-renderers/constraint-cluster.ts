import { html, nothing } from "lit";
import type { ConfigEntry, RequiredGroup } from "../../../api/types/config-entries.js";
import { isEntryVisible } from "../../../util/config-validation.js";
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
        if (!entries.find((e) => e.key === key)?.exclusive_group) keys.add(key);
      }
    }
    const members = entries.filter((e) => keys.has(e.key));
    members.forEach((m) => memberKeys.add(m.key));
    clusters.push({ members, cardinality, inclusiveKeys });
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
  const option = (key: string): string => {
    const group = byKey.get(key)?.group;
    const members = group
      ? entries.filter((e) => e.group === group).map((e) => e.key)
      : [key];
    const labels = members.map(labelOf);
    return labels.length > 1 ? `(${labels.join(", ")})` : labels[0];
  };
  return keys.map(option).join(", ");
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
    keys: formatConstraintKeys(prompt.keys, cluster.members, ctx),
  });

  const visibleMembers = cluster.members.filter(
    (m) =>
      ctx.getAt([m.key]) !== undefined ||
      isEntryVisible(m, values, ctx.presentComponents, targetPlatform)
  );
  return html`
    <div
      class="nested-group constraint-cluster"
      data-field-key=${fieldKeyAttr([cluster.members[0].key])}
    >
      <div class="constraint-cluster-header ${prompt.satisfied ? "" : "unsatisfied"}">
        ${prompt.satisfied
          ? nothing
          : html`<wa-icon library="mdi" name="alert-circle-outline"></wa-icon>`}
        <span>${message}</span>
      </div>
      <div class="nested-fields">
        ${visibleMembers.map((m) => ctx.renderEntry(m, [m.key]))}
      </div>
    </div>
  `;
}
