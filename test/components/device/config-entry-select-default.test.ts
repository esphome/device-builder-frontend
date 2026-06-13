import { describe, expect, it } from "vitest";
import type { ConfigValueOption } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderSelectField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import { findElementBindings, makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

// The discriminator the backend ships for a typed_schema (spi `type`) is
// optional with a default. An unset select shows the default's label as a
// muted placeholder and tags the default option in the menu, since
// wa-select activates the first option when nothing is committed.
const OPTIONS: ConfigValueOption[] = [
  { value: "single", label: "single" },
  { value: "quad", label: "quad" },
  { value: "octal", label: "octal" },
];

const serialize = (tpl: unknown): string =>
  JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));

function renderFor(value: string | undefined, overrides: Record<string, unknown> = {}) {
  const entry = makeEntry(ConfigEntryType.SELECT, {
    options: OPTIONS,
    default_value: "single",
    ...overrides,
  });
  const values = value === undefined ? {} : { type: value };
  return renderSelectField(entry, ["type"], makeRenderCtx(values));
}

function selectPlaceholder(tpl: unknown): unknown {
  return findElementBindings(tpl, "wa-select")[0]?.placeholder;
}

describe("renderSelectField — default in the menu", () => {
  it("shows the default's label as the placeholder when unset", () => {
    expect(selectPlaceholder(renderFor(undefined))).toBe("single");
  });

  it("gives the default option a muted second line so it stays identifiable", () => {
    const json = serialize(renderFor(undefined));
    expect(json).toContain("option-default-note");
    expect(json).toContain("device.default_option_tag");
  });

  it("marks only the default option, not the others", () => {
    const json = serialize(renderFor(undefined));
    expect(json.match(/option-default-note/g) ?? []).toHaveLength(1);
  });

  it("does not mark anything when the schema has no default", () => {
    expect(serialize(renderFor(undefined, { default_value: null }))).not.toContain(
      "option-default-note"
    );
  });
});
