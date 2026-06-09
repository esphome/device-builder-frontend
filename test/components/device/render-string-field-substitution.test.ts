/**
 * Pins that ``renderStringField`` shows a substitution preview when the
 * value references a ``${var}`` defined in the file's own
 * ``substitutions:``, and nothing when there's no resolvable reference.
 */
import { describe, expect, it } from "vitest";

import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { renderStringField } from "../../../src/components/device/config-entry-renderers-shared.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { makeRenderCtx } from "./_renderer-fixtures.js";

const YAML = [
  "substitutions:",
  "  upper_devicename: Driveway Gate",
  "binary_sensor:",
  "  - platform: gpio",
  "    name: ${upper_devicename} Moving",
  "",
].join("\n");

function makeEntry(): ConfigEntry {
  return makeConfigEntry({ key: "name", type: ConfigEntryType.STRING, label: "Name" });
}

function ctxFor(value: string): RenderCtx {
  return makeRenderCtx(
    { name: value },
    { board: null, overrides: { sectionKey: "binary_sensor", yaml: YAML } }
  );
}

const serialize = (tpl: unknown): string =>
  JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));

describe("renderStringField — substitution preview", () => {
  it("previews the resolved value when the field references a substitution", () => {
    const json = serialize(
      renderStringField(
        makeEntry(),
        "text",
        ["name"],
        ctxFor("${upper_devicename} Moving")
      )
    );
    expect(json).toContain("substitution-note");
    expect(json).toContain("Driveway Gate Moving");
  });

  it("shows no preview for a plain value", () => {
    const json = serialize(
      renderStringField(makeEntry(), "text", ["name"], ctxFor("Front Door"))
    );
    expect(json).not.toContain("substitution-note");
  });

  it("shows no preview for an unresolvable reference", () => {
    const json = serialize(
      renderStringField(makeEntry(), "text", ["name"], ctxFor("${unknown} Moving"))
    );
    expect(json).not.toContain("substitution-note");
  });
});
