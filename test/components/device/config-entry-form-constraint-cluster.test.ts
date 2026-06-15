/**
 * Either/or constraint members (chipset OR the four manual timings) fold into
 * one bordered box, adjacent, with a reactive header.
 */
import { describe, expect, it } from "vitest";

import type {
  ConfigEntry,
  RequiredGroup,
} from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import {
  buildConstraintClusters,
  formatConstraintKeys,
  renderConstraintClusterField,
} from "../../../src/components/device/config-entry-renderers/constraint-cluster.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

const ENTRIES: ConfigEntry[] = [
  makeConfigEntry({ key: "rgb_order", type: ConfigEntryType.STRING, label: "RGB Order" }),
  makeConfigEntry({ key: "chipset", type: ConfigEntryType.STRING, label: "Chipset" }),
  makeConfigEntry({
    key: "bit0_high",
    type: ConfigEntryType.STRING,
    label: "Bit0 High",
    group: "custom",
  }),
  makeConfigEntry({
    key: "bit0_low",
    type: ConfigEntryType.STRING,
    label: "Bit0 Low",
    group: "custom",
  }),
  makeConfigEntry({
    key: "bit1_high",
    type: ConfigEntryType.STRING,
    label: "Bit1 High",
    group: "custom",
  }),
  makeConfigEntry({
    key: "bit1_low",
    type: ConfigEntryType.STRING,
    label: "Bit1 Low",
    group: "custom",
  }),
];
const REQUIRED_GROUPS: RequiredGroup[] = [
  { kind: "exactly_one", keys: ["chipset", "bit0_high"] },
];

function ctxFor(values: Record<string, unknown>): RenderCtx {
  return {
    localize: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${params.keys}` : key,
    scopeValues: () => values,
    getAt: (path: string[]) => values[path[0]],
    board: null,
    presentComponents: new Set<string>(),
    renderEntry: (entry: ConfigEntry) => `<entry:${entry.key}>`,
  } as unknown as RenderCtx;
}

const serialize = (tpl: unknown): string =>
  JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v)) ?? "";

describe("buildConstraintClusters", () => {
  it("absorbs the chipset cardinality alternative into the timing group", () => {
    const { clusters, memberKeys } = buildConstraintClusters(ENTRIES, REQUIRED_GROUPS);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members.map((m) => m.key)).toEqual([
      "chipset",
      "bit0_high",
      "bit0_low",
      "bit1_high",
      "bit1_low",
    ]);
    expect(clusters[0].inclusiveKeys).toEqual([
      "bit0_high",
      "bit0_low",
      "bit1_high",
      "bit1_low",
    ]);
    expect([...memberKeys]).not.toContain("rgb_order");
  });

  it("clusters nothing without an inclusive group", () => {
    const flat = ENTRIES.map((e) => ({ ...e, group: undefined }));
    expect(buildConstraintClusters(flat, REQUIRED_GROUPS).clusters).toHaveLength(0);
  });
});

describe("formatConstraintKeys", () => {
  it("collapses an inclusive member into its parenthesized set", () => {
    expect(formatConstraintKeys(["chipset", "bit0_high"], ENTRIES, ctxFor({}))).toBe(
      "Chipset, (Bit0 High, Bit0 Low, Bit1 High, Bit1 Low)"
    );
  });
});

describe("renderConstraintClusterField", () => {
  const [cluster] = buildConstraintClusters(ENTRIES, REQUIRED_GROUPS).clusters;

  it("renders one box with all members and an unsatisfied header when empty", () => {
    const out = serialize(renderConstraintClusterField(cluster, ctxFor({})));
    expect(out).toContain("nested-group");
    expect(out).toContain("unsatisfied");
    expect(out).toContain("device.constraint_exactly_one|Chipset, (Bit0 High");
    for (const key of ["chipset", "bit0_high", "bit1_low"]) {
      expect(out).toContain(`<entry:${key}>`);
    }
  });

  it("drops the warning tone once chipset satisfies the choice", () => {
    const out = serialize(
      renderConstraintClusterField(cluster, ctxFor({ chipset: "SK6812" }))
    );
    expect(out).not.toContain("unsatisfied");
  });
});
