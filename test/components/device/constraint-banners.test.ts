import { describe, expect, it } from "vitest";

import type {
  ConfigEntry,
  RequiredGroup,
} from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { collectUnsatisfiedConstraints } from "../../../src/components/device/config-entry-renderers/constraint-banners.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

// Echo the keys verbatim so assertions can see exactly which group surfaced,
// standing in for the real formatConstraintKeys(keys, entries, ctx).
const formatKeys = (keys: string[]): string => keys.join(",");

const ENTRIES: ConfigEntry[] = [
  makeConfigEntry({ key: "ssid", type: ConfigEntryType.STRING, label: "SSID" }),
  makeConfigEntry({ key: "networks", type: ConfigEntryType.STRING, label: "Networks" }),
];
const REQUIRED_GROUPS: RequiredGroup[] = [
  { kind: "at_least_one", keys: ["ssid", "networks"] },
];

function collect(
  overrides: {
    entries?: ConfigEntry[];
    requiredGroups?: RequiredGroup[];
    values?: Record<string, unknown>;
  } = {},
  clustered: Set<string> = new Set()
) {
  return collectUnsatisfiedConstraints(
    {
      entries: overrides.entries ?? ENTRIES,
      requiredGroups: overrides.requiredGroups ?? REQUIRED_GROUPS,
      values: overrides.values ?? {},
      presentComponents: new Set(),
      targetPlatform: null,
      formatKeys,
    },
    clustered
  );
}

describe("collectUnsatisfiedConstraints", () => {
  it("surfaces an unsatisfied, unclustered cardinality group", () => {
    expect(collect()).toEqual([{ kind: "at_least_one", keys: "ssid,networks" }]);
  });

  it("returns nothing once the group is satisfied", () => {
    expect(collect({ values: { ssid: "home" } })).toEqual([]);
  });

  it("skips a group whose members are clustered (the box owns the prompt)", () => {
    expect(collect({}, new Set(["ssid"]))).toEqual([]);
  });

  it("skips a group whose members are not rendered entries", () => {
    // e.g. sensor.pid references climate.pid's cool_output/heat_output, which
    // aren't fields on the sensor form — no banner the user can act on.
    expect(
      collect({
        requiredGroups: [{ kind: "at_least_one", keys: ["cool_output", "heat_output"] }],
      })
    ).toEqual([]);
  });

  it("surfaces a residual inclusive group as an all_or_none banner", () => {
    // An inclusive `group` whose members aren't folded into a cluster box:
    // half-filled trips the all_or_none prompt.
    const entries: ConfigEntry[] = [
      makeConfigEntry({ key: "cert", type: ConfigEntryType.STRING, group: "tls" }),
      makeConfigEntry({ key: "key", type: ConfigEntryType.STRING, group: "tls" }),
    ];
    expect(collect({ entries, requiredGroups: [], values: { cert: "a.pem" } })).toEqual([
      { kind: "all_or_none", keys: "cert,key" },
    ]);
  });

  it("leaves a fully-satisfied inclusive group alone", () => {
    const entries: ConfigEntry[] = [
      makeConfigEntry({ key: "cert", type: ConfigEntryType.STRING, group: "tls" }),
      makeConfigEntry({ key: "key", type: ConfigEntryType.STRING, group: "tls" }),
    ];
    expect(
      collect({ entries, requiredGroups: [], values: { cert: "a.pem", key: "b.pem" } })
    ).toEqual([]);
  });

  it("orders cardinality banners before inclusive all_or_none banners", () => {
    // Both groups unsatisfied at once: the required at_least_one (ssid/networks
    // empty) and the half-filled inclusive tls group. The host renders the array
    // in order, so cardinality must precede the residual all_or_none banner.
    const entries: ConfigEntry[] = [
      ...ENTRIES,
      makeConfigEntry({ key: "cert", type: ConfigEntryType.STRING, group: "tls" }),
      makeConfigEntry({ key: "key", type: ConfigEntryType.STRING, group: "tls" }),
    ];
    expect(collect({ entries, values: { cert: "a.pem" } })).toEqual([
      { kind: "at_least_one", keys: "ssid,networks" },
      { kind: "all_or_none", keys: "cert,key" },
    ]);
  });
});
