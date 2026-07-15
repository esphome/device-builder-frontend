import { describe, expect, it } from "vitest";
import type { ConfigValueOption } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderSelectField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import { makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

// Described options render a quiet second line; the default option
// stacks both notes.
const OPTIONS: ConfigValueOption[] = [
  {
    value: "basic",
    label: "basic",
    description: "Sends the password in an easily reversible form.",
  },
  { value: "digest", label: "digest", description: "Sends only hashes. Recommended." },
];

const serialize = (tpl: unknown): string =>
  JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));

function renderFor(overrides: Record<string, unknown> = {}) {
  const entry = makeEntry(ConfigEntryType.SELECT, { options: OPTIONS, ...overrides });
  return renderSelectField(entry, ["type"], makeRenderCtx({}));
}

describe("renderSelectField — option descriptions", () => {
  it("renders each described option with a quiet second line", () => {
    const json = serialize(renderFor());
    expect(json.match(/option-description-note/g)).toHaveLength(2);
    expect(json).toContain("Sends only hashes. Recommended.");
  });

  it("stacks the description with the default tag on the default option", () => {
    const json = serialize(renderFor({ default_value: "basic" }));
    expect(json.match(/option-description-note/g)).toHaveLength(2);
    expect(json.match(/option-default-note/g)).toHaveLength(1);
  });

  it("keeps undescribed options on the plain single-line shape", () => {
    const plain = makeEntry(ConfigEntryType.SELECT, {
      options: [{ value: "a", label: "a" }],
    });
    const json = serialize(renderSelectField(plain, ["type"], makeRenderCtx({})));
    expect(json).not.toContain("option-description-note");
    expect(json).not.toContain("option-stack");
  });
});
