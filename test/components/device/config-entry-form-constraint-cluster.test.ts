/**
 * Either/or constraint members (chipset OR the four manual timings) fold into
 * one bordered box, adjacent, with a reactive header.
 */
import { nothing } from "lit";
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
  isRadioCluster,
  renderConstraintClusterField,
  renderConstraintRadioField,
  selectClusterAlternative,
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

function ctxFor(
  values: Record<string, unknown>,
  entries: ConfigEntry[] = ENTRIES
): RenderCtx {
  return {
    localize: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${params.keys}` : key,
    scopeValues: () => values,
    getAt: (path: string[]) => values[path[0]],
    board: null,
    presentComponents: new Set<string>(),
    entries,
    renderEntry: (entry: ConfigEntry) => `<entry:${entry.key}>`,
  } satisfies Partial<RenderCtx> as unknown as RenderCtx;
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

  it("drops the cardinality when an alternative is not a rendered member", () => {
    // Featured components preset/hide chipset, so only the timing group remains;
    // fall back to the all-or-none box instead of a one-option radio.
    const noChipset = ENTRIES.filter((e) => e.key !== "chipset");
    const [cluster] = buildConstraintClusters(noChipset, REQUIRED_GROUPS).clusters;
    expect(cluster.cardinality).toBeUndefined();
    expect(isRadioCluster(cluster)).toBe(false);
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

  it("localizes a cardinality key that's absent from members via ctx.entries", () => {
    // A key that's also an exclusive_group member is dropped from cluster
    // members, but the full entry set still resolves its label (no raw key).
    const timings = ENTRIES.filter((e) => e.group === "custom");
    const absentChipset = {
      members: timings,
      cardinality: { kind: "at_least_one" as const, keys: ["chipset", "bit0_high"] },
      inclusiveKeys: timings.map((m) => m.key),
    };
    const ctx = ctxFor({});
    ctx.entries = ENTRIES;
    const out = serialize(renderConstraintClusterField(absentChipset, ctx));
    expect(out).toContain("device.constraint_at_least_one|Chipset, (Bit0 High");
    expect(out).not.toContain("|chipset,");
  });
});

// Stateful ctx: emitChange mutates a backing values dict (delete on undefined)
// and the cluster choice/stash live in real Maps, so a full radio switch can
// be driven and the resulting values inspected.
function statefulCtx(initial: Record<string, unknown>) {
  const values: Record<string, unknown> = { ...initial };
  const stash = new Map<string, unknown>();
  const choice = new Map<string, string>();
  const ctx = {
    localize: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}|${params.keys}` : key,
    disabled: false,
    scopeValues: () => values,
    getAt: (path: string[]) => values[path[0]],
    emitChange: (path: string[], value: unknown) => {
      if (value === undefined) delete values[path[0]];
      else values[path[0]] = value;
    },
    board: null,
    presentComponents: new Set<string>(),
    entries: ENTRIES,
    renderEntry: (entry: ConfigEntry) => `<entry:${entry.key}>`,
    getClusterChoice: (id: string) => choice.get(id),
    setClusterChoice: (id: string, alt: string) => choice.set(id, alt),
    getClusterStash: (id: string, key: string) => stash.get(`${id} ${key}`),
    setClusterStash: (id: string, key: string, v: unknown) =>
      stash.set(`${id} ${key}`, v),
    clearClusterStash: (id: string, key: string) => stash.delete(`${id} ${key}`),
  } satisfies Partial<RenderCtx> as unknown as RenderCtx;
  return { ctx, values, stash, choice };
}

const TIMINGS = {
  bit0_high: "400ns",
  bit0_low: "850ns",
  bit1_high: "800ns",
  bit1_low: "450ns",
};

const MQTT_ENTRIES: ConfigEntry[] = [
  makeConfigEntry({ key: "broker", type: ConfigEntryType.STRING, label: "Broker" }),
  makeConfigEntry({
    key: "client_certificate",
    type: ConfigEntryType.STRING,
    label: "Client Certificate",
    group: "cert-key-pair",
  }),
  makeConfigEntry({
    key: "client_certificate_key",
    type: ConfigEntryType.STRING,
    label: "Client Certificate Key",
    group: "cert-key-pair",
  }),
];

describe("isRadioCluster", () => {
  it("is true for an exactly_one cluster and false for all-or-none", () => {
    const [ledCluster] = buildConstraintClusters(ENTRIES, REQUIRED_GROUPS).clusters;
    const [mqttCluster] = buildConstraintClusters(MQTT_ENTRIES, []).clusters;
    expect(isRadioCluster(ledCluster)).toBe(true);
    expect(isRadioCluster(mqttCluster)).toBe(false);
  });
});

// Pattern B: an inclusive all-or-none group with no cardinality renders the
// static box (not a radio), with the all_or_none prompt toned by group state.
describe("renderConstraintClusterField (all-or-none box)", () => {
  const [cluster] = buildConstraintClusters(MQTT_ENTRIES, []).clusters;

  it("boxes both members and warns when only one is set", () => {
    const out = serialize(
      renderConstraintClusterField(
        cluster,
        ctxFor({ client_certificate: "/d.crt" }, MQTT_ENTRIES)
      )
    );
    expect(out).toContain("nested-group");
    expect(out).toContain("unsatisfied");
    // The two members share one group, so the prompt names the pair once.
    expect(out).toContain(
      "device.constraint_all_or_none|(Client Certificate, Client Certificate Key)"
    );
    expect(out).not.toContain(
      "(Client Certificate, Client Certificate Key), (Client Certificate, Client Certificate Key)"
    );
    expect(out).toContain("<entry:client_certificate>");
    expect(out).toContain("<entry:client_certificate_key>");
  });

  it("drops the warning tone when both are set", () => {
    const out = serialize(
      renderConstraintClusterField(
        cluster,
        ctxFor(
          { client_certificate: "/d.crt", client_certificate_key: "/d.key" },
          MQTT_ENTRIES
        )
      )
    );
    expect(out).not.toContain("unsatisfied");
  });

  it("renders nothing when every member is gated off", () => {
    const hidden: ConfigEntry[] = [
      makeConfigEntry({
        key: "a",
        type: ConfigEntryType.STRING,
        group: "g",
        hidden: true,
      }),
      makeConfigEntry({
        key: "b",
        type: ConfigEntryType.STRING,
        group: "g",
        hidden: true,
      }),
    ];
    const [gated] = buildConstraintClusters(hidden, []).clusters;
    expect(renderConstraintClusterField(gated, ctxFor({}))).toBe(nothing);
  });
});

describe("renderConstraintRadioField", () => {
  const [cluster] = buildConstraintClusters(ENTRIES, REQUIRED_GROUPS).clusters;

  it("renders a radio per alternative with no fields and no warning when empty", () => {
    const out = serialize(renderConstraintRadioField(cluster, statefulCtx({}).ctx));
    expect(out).toContain("wa-radio-group");
    expect(out).toContain("Bit0 High, Bit0 Low, Bit1 High, Bit1 Low");
    expect(out).not.toContain("<entry:bit0_high>");
    expect(out).not.toContain("<entry:chipset>");
  });

  it("infers the chipset side from its value and shows only that field", () => {
    const out = serialize(
      renderConstraintRadioField(cluster, statefulCtx({ chipset: "WS2812" }).ctx)
    );
    expect(out).toContain("<entry:chipset>");
    expect(out).not.toContain("<entry:bit0_high>");
  });

  it("shows the timing fields and never a warning, even when partial", () => {
    const out = serialize(
      renderConstraintRadioField(cluster, statefulCtx({ bit0_high: "400ns" }).ctx)
    );
    expect(out).toContain("<entry:bit0_high>");
    expect(out).not.toContain("<entry:chipset>");
    // The radio enforces the choice, so the cluster never reads as unsatisfied.
    expect(out).not.toContain("unsatisfied");
  });

  it("falls back to the static box when fewer than two alternatives render", () => {
    // chipset gated off at runtime leaves one alternative, so a radio chooser
    // makes no sense; render the static box instead.
    const hiddenChipset = ENTRIES.map((e) =>
      e.key === "chipset" ? { ...e, hidden: true } : e
    );
    const [cluster] = buildConstraintClusters(hiddenChipset, REQUIRED_GROUPS).clusters;
    const out = serialize(renderConstraintRadioField(cluster, ctxFor({})));
    expect(out).not.toContain("wa-radio-group");
    expect(out).toContain("nested-group");
  });
});

describe("selectClusterAlternative", () => {
  const [cluster] = buildConstraintClusters(ENTRIES, REQUIRED_GROUPS).clusters;

  it("preserves the deselected side's values and emits only the selected one", () => {
    const state = statefulCtx({ ...TIMINGS });
    // Switch timings -> chipset: the four bit values leave the config.
    selectClusterAlternative(cluster, state.ctx, "chipset");
    expect(state.values).toEqual({});
    expect(state.choice.get("chipset")).toBe("chipset");
    // Switch back: the stash restores every timing value verbatim.
    selectClusterAlternative(cluster, state.ctx, "bit0_high");
    expect(state.values).toEqual(TIMINGS);
    expect(state.choice.get("chipset")).toBe("bit0_high");
  });
});
