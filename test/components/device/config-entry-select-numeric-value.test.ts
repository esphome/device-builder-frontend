import { describe, expect, it } from "vitest";
import type { ConfigValueOption } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderSuggestionSelect } from "../../../src/components/device/config-entry-renderers-shared.js";
import { renderSelectField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import { findElementBindings, makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

// esp32's ``minimum_chip_revision`` is a string enum spelled "3.0", but a
// bare YAML ``3.0`` reads as the number 3 (device-builder-frontend#1942).
const OPTIONS: ConfigValueOption[] = ["0.0", "1.0", "1.1", "2.0", "3.0", "3.1"].map(
  (value) => ({ value, label: value })
);

function selectedOptions(tpl: unknown): string[] {
  return findElementBindings(tpl, "wa-option")
    .filter((b) => b["?selected"] === true)
    .map((b) => b.value as string);
}

describe("renderSelectField — a bare YAML decimal", () => {
  it.each([
    [3, "3.0"],
    [1.1, "1.1"],
    ["3.0", "3.0"],
  ])("marks the option spelled for %s as selected", (value, expected) => {
    const entry = makeEntry(ConfigEntryType.SELECT, { options: OPTIONS });
    const tpl = renderSelectField(entry, ["rev"], makeRenderCtx({ rev: value }));
    expect(selectedOptions(tpl)).toEqual([expected]);
  });

  it("selects nothing for a revision the catalog does not list", () => {
    const entry = makeEntry(ConfigEntryType.SELECT, { options: OPTIONS });
    const tpl = renderSelectField(entry, ["rev"], makeRenderCtx({ rev: 4 }));
    expect(selectedOptions(tpl)).toEqual([]);
  });
});

describe("renderSuggestionSelect — a bare YAML decimal", () => {
  it("marks the suggestion spelled for the number as selected", () => {
    const entry = makeEntry(ConfigEntryType.STRING, { suggestions: ["2.0", "3.0"] });
    const tpl = renderSuggestionSelect(
      entry,
      ["rev"],
      "3",
      false,
      false,
      makeRenderCtx({})
    );
    expect(selectedOptions(tpl)).toEqual(["3.0"]);
  });
});
