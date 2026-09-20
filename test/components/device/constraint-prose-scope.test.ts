/**
 * The baked constraint prose is stripped only for members the form replaces
 * with a reactive banner/cluster (``ctx.reactiveConstraintEntries``), at the
 * root or in a nested block; any other member keeps its prose.
 */
import { describe, expect, it } from "vitest";

import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import { renderLabel } from "../../../src/components/device/config-entry-renderers-shared.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { constraintMembers } from "../../../src/util/constraint-groups.js";
import { makeRenderCtx } from "./_renderer-fixtures.js";

const PROSE = "**Set together, or leave all blank.**\n\nThe real description.";

const serialize = (tpl: unknown): string =>
  JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v)) ?? "";

describe("constraint-prose strip scoping", () => {
  const entry: ConfigEntry = makeConfigEntry({
    key: "client_certificate",
    type: ConfigEntryType.STRING,
    description: PROSE,
  });

  it("strips the baked prose for a reactively-rendered member", () => {
    const ctx = makeRenderCtx(
      {},
      { overrides: { reactiveConstraintEntries: new Set([entry]) } }
    );
    const out = serialize(renderLabel(entry, ctx, { path: ["client_certificate"] }));
    expect(out).toContain("The real description.");
    expect(out).not.toContain("Set together");
  });

  it("keeps the prose for a member the form doesn't reactively render", () => {
    const ctx = makeRenderCtx(
      {},
      { overrides: { reactiveConstraintEntries: new Set() } }
    );
    const out = serialize(renderLabel(entry, ctx, { path: ["client_certificate"] }));
    expect(out).toContain("Set together");
  });

  it("collects the members of a nested block's own groups too", () => {
    const certificate = makeConfigEntry({ key: "certificate", group: "cert_and_key" });
    const key = makeConfigEntry({ key: "key", group: "cert_and_key" });
    const identity = makeConfigEntry({ key: "identity" });
    const username = makeConfigEntry({ key: "username" });
    const eap = makeConfigEntry({
      key: "eap",
      type: ConfigEntryType.NESTED,
      required_groups: [{ kind: "at_least_one", keys: ["identity", "certificate"] }],
      config_entries: [certificate, key, identity, username],
    });
    const ssid = makeConfigEntry({ key: "ssid" });
    expect(constraintMembers([ssid, eap], [])).toEqual(
      new Set([certificate, key, identity])
    );
  });
});
