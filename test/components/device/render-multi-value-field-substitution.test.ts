/**
 * Pins that ``renderMultiValueField`` previews resolved substitutions per
 * row, matching the single-value string renderer (sntp ``servers:`` holding
 * three server substitutions).
 */
import { describe, expect, it } from "vitest";

import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { renderMultiValueField } from "../../../src/components/device/config-entry-renderers.js";
import { makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

const YAML = [
  "substitutions:",
  "  sntp_server_1: 0.pool.ntp.org",
  "  sntp_server_2: 1.pool.ntp.org",
  "time:",
  "  - platform: sntp",
  "",
].join("\n");

function ctxFor(items: unknown[]): RenderCtx {
  return makeRenderCtx(
    { servers: items },
    { overrides: { sectionKey: "time", yaml: YAML } }
  );
}

const serialize = (tpl: unknown): string =>
  JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));

describe("renderMultiValueField — substitution preview", () => {
  it("previews the resolved value for each row that references a substitution", () => {
    const json = serialize(
      renderMultiValueField(
        makeEntry(ConfigEntryType.STRING),
        ["servers"],
        ctxFor(["${sntp_server_1}", "${sntp_server_2}"])
      )
    );
    expect(json).toContain("substitution-note");
    expect(json).toContain("0.pool.ntp.org");
    expect(json).toContain("1.pool.ntp.org");
  });

  it("shows no preview for plain rows", () => {
    const json = serialize(
      renderMultiValueField(
        makeEntry(ConfigEntryType.STRING),
        ["servers"],
        ctxFor(["2.pool.ntp.org"])
      )
    );
    expect(json).not.toContain("substitution-note");
  });

  it("flags an unresolved reference with the external marker", () => {
    const json = serialize(
      renderMultiValueField(
        makeEntry(ConfigEntryType.STRING),
        ["servers"],
        ctxFor(["${sntp_server_3}"])
      )
    );
    expect(json).toContain("substitution-note--external");
    expect(json).toContain("substitution-warn");
  });
});
