/**
 * The baked constraint prose is stripped only for members the form replaces
 * with a reactive banner/cluster (``ctx.reactiveConstraintPaths``), at the
 * root or in a nested block; any other member keeps its prose.
 */
import { describe, expect, it } from "vitest";

import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import { renderLabel } from "../../../src/components/device/config-entry-renderers-shared.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { constraintMemberPaths } from "../../../src/util/constraint-groups.js";
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
      { overrides: { reactiveConstraintPaths: new Set(["client_certificate"]) } }
    );
    const out = serialize(renderLabel(entry, ctx, { path: ["client_certificate"] }));
    expect(out).toContain("The real description.");
    expect(out).not.toContain("Set together");
  });

  it("keeps the prose for a member the form doesn't reactively render", () => {
    const ctx = makeRenderCtx({}, { overrides: { reactiveConstraintPaths: new Set() } });
    const out = serialize(renderLabel(entry, ctx, { path: ["client_certificate"] }));
    expect(out).toContain("Set together");
  });

  it("strips it for a board-locked copy of the member, which is a new object", () => {
    const ctx = makeRenderCtx(
      {},
      { overrides: { reactiveConstraintPaths: new Set(["client_certificate"]) } }
    );
    const locked = { ...entry, locked: true };
    const out = serialize(renderLabel(locked, ctx, { path: ["client_certificate"] }));
    expect(out).not.toContain("Set together");
  });

  it("matches a member inside a list row by its schema path", () => {
    const ctx = makeRenderCtx(
      {},
      {
        overrides: {
          reactiveConstraintPaths: new Set(["networks.eap.client_certificate"]),
        },
      }
    );
    const path = ["networks", "0", "eap", "client_certificate"];
    expect(serialize(renderLabel(entry, ctx, { path }))).not.toContain("Set together");
  });

  it("collects nested scopes but not a list row's own members", () => {
    const eapChildren = [
      makeConfigEntry({ key: "certificate", group: "cert_and_key" }),
      makeConfigEntry({ key: "key", group: "cert_and_key" }),
      makeConfigEntry({ key: "identity" }),
      makeConfigEntry({ key: "username" }),
    ];
    const eap = makeConfigEntry({
      key: "eap",
      type: ConfigEntryType.NESTED,
      required_groups: [{ kind: "at_least_one", keys: ["identity", "certificate"] }],
      config_entries: eapChildren,
    });
    const networks = makeConfigEntry({
      key: "networks",
      type: ConfigEntryType.NESTED,
      multi_value: true,
      config_entries: [
        // A row paints no banner, so its own grouped members keep their prose.
        makeConfigEntry({ key: "bssid", group: "pin" }),
        makeConfigEntry({ key: "channel", group: "pin" }),
        eap,
      ],
    });
    expect(
      [
        ...constraintMemberPaths([makeConfigEntry({ key: "ssid" }), eap, networks], []),
      ].sort()
    ).toEqual([
      "eap.certificate",
      "eap.identity",
      "eap.key",
      "networks.eap.certificate",
      "networks.eap.identity",
      "networks.eap.key",
    ]);
  });
});
