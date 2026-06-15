/**
 * The baked constraint prose is stripped only for members the form replaces
 * with a reactive banner/cluster (keys in ctx.reactiveConstraintKeys); a member
 * the form doesn't reactively render (nested scope) keeps its prose.
 */
import { describe, expect, it } from "vitest";

import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import { renderLabel } from "../../../src/components/device/config-entry-renderers-shared.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
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
      { overrides: { reactiveConstraintKeys: new Set(["client_certificate"]) } }
    );
    const out = serialize(renderLabel(entry, ctx));
    expect(out).toContain("The real description.");
    expect(out).not.toContain("Set together");
  });

  it("keeps the prose for a member the form doesn't reactively render", () => {
    const ctx = makeRenderCtx({}, { overrides: { reactiveConstraintKeys: new Set() } });
    const out = serialize(renderLabel(entry, ctx));
    expect(out).toContain("Set together");
  });
});
