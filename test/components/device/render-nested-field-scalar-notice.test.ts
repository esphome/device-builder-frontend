/**
 * A non-empty scalar at a NESTED key (a shorthand the visual editor
 * can't model with its flag group, e.g. a pin ``mode: OUTPUT``) renders
 * as a read-only notice showing the value, not an empty collapsible
 * group; a cleared "" falls through to the group.
 */
import { describe, expect, it } from "vitest";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderNestedField } from "../../../src/components/device/config-entry-renderers.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";
import { makeRenderCtx } from "./_renderer-fixtures.js";

const modeEntry = () =>
  makeConfigEntry({
    key: "mode",
    type: ConfigEntryType.NESTED,
    config_entries: [makeConfigEntry({ key: "output", type: ConfigEntryType.BOOLEAN })],
  });

describe("renderNestedField — scalar value", () => {
  it("renders a read-only notice (no collapsible group) for a scalar", () => {
    const tpl = renderNestedField(
      modeEntry(),
      ["mode"],
      makeRenderCtx({ mode: "OUTPUT" })
    );
    expect(findTemplatesByAnchor(tpl, "field-description")).not.toHaveLength(0);
    expect(findTemplatesByAnchor(tpl, "nested-toggle")).toHaveLength(0);
  });

  it("renders the normal collapsible group for an object value", () => {
    const tpl = renderNestedField(modeEntry(), ["mode"], makeRenderCtx({ mode: {} }));
    expect(findTemplatesByAnchor(tpl, "nested-toggle")).not.toHaveLength(0);
    expect(findTemplatesByAnchor(tpl, "field-description")).toHaveLength(0);
  });

  it("renders the flag group for a cleared (empty-string) value, not the notice", () => {
    const tpl = renderNestedField(modeEntry(), ["mode"], makeRenderCtx({ mode: "" }));
    expect(findTemplatesByAnchor(tpl, "nested-toggle")).not.toHaveLength(0);
    expect(findTemplatesByAnchor(tpl, "field-description")).toHaveLength(0);
  });
});
