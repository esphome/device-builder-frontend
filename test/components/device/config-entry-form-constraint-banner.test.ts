/**
 * @vitest-environment happy-dom
 *
 * The fallback banner prompts for unsatisfied cardinality groups that aren't
 * visually clustered, and skips any group whose members render in a cluster box.
 */
import { describe, expect, it } from "vitest";

import type {
  ConfigEntry,
  RequiredGroup,
} from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { ESPHomeConfigEntryForm } from "../../../src/components/device/config-entry-form.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { makeConfigEntry } from "../../util/_make-config-entry.js";

const ctx = {
  localize: (key: string, params?: Record<string, unknown>) =>
    params ? `${key}|${params.keys}` : key,
} as unknown as RenderCtx;

const serialize = (tpl: unknown): string =>
  // `nothing` (a symbol) stringifies to undefined — treat it as "no banners".
  JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v)) ?? "";

// Pure cardinality (no inclusive `group`) — these stay in the flow and surface
// through the banner rather than a cluster box.
const ENTRIES: ConfigEntry[] = [
  makeConfigEntry({ key: "ssid", type: ConfigEntryType.STRING, label: "SSID" }),
  makeConfigEntry({ key: "networks", type: ConfigEntryType.STRING, label: "Networks" }),
];
const REQUIRED_GROUPS: RequiredGroup[] = [
  { kind: "at_least_one", keys: ["ssid", "networks"] },
];

function banners(
  values: Record<string, unknown>,
  clustered: Set<string> = new Set()
): string {
  const form = new ESPHomeConfigEntryForm();
  form.entries = ENTRIES;
  form.values = values;
  form.requiredGroups = REQUIRED_GROUPS;
  const out = (
    form as unknown as {
      _renderConstraintBanners(c: RenderCtx, clustered: Set<string>): unknown;
    }
  )._renderConstraintBanners(ctx, clustered);
  return serialize(out);
}

describe("config-entry-form constraint banners", () => {
  it("prompts an unsatisfied, unclustered cardinality group", () => {
    const out = banners({});
    expect(out).toContain("constraint-banner");
    expect(out).toContain("device.constraint_at_least_one");
  });

  it("shows no banner once the group is satisfied", () => {
    expect(banners({ ssid: "home" })).not.toContain("constraint-banner");
  });

  it("skips a group whose members are clustered (the box owns the prompt)", () => {
    expect(banners({}, new Set(["ssid"]))).not.toContain("constraint-banner");
  });

  it("skips a group whose members are not rendered entries", () => {
    // e.g. sensor.pid references climate.pid's cool_output/heat_output, which
    // aren't fields on the sensor form — no banner the user can act on.
    const form = new ESPHomeConfigEntryForm();
    form.entries = ENTRIES;
    form.values = {};
    form.requiredGroups = [
      { kind: "at_least_one", keys: ["cool_output", "heat_output"] },
    ];
    const out = serialize(
      (
        form as unknown as {
          _renderConstraintBanners(c: RenderCtx, clustered: Set<string>): unknown;
        }
      )._renderConstraintBanners(ctx, new Set())
    );
    expect(out).not.toContain("constraint-banner");
  });
});
