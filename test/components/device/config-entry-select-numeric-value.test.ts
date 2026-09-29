import { describe, expect, it } from "vitest";
import type { ConfigValueOption } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderSuggestionSelect } from "../../../src/components/device/config-entry-renderers-shared.js";
import { renderSelectField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import {
  findElementBindings,
  makeEntry,
  makeRenderCtx,
  makeTestBoard,
} from "./_renderer-fixtures.js";

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
  ])("marks the option spelled for %s as selected", (value, expected) => {
    const entry = makeEntry(ConfigEntryType.SELECT, { options: OPTIONS });
    const tpl = renderSelectField(entry, ["rev"], makeRenderCtx({ rev: value }));
    expect(selectedOptions(tpl)).toEqual([expected]);
  });

  it.each([[4], ["3"]])(
    "selects nothing for %o, which spells no listed revision",
    (value) => {
      const entry = makeEntry(ConfigEntryType.SELECT, { options: OPTIONS });
      const tpl = renderSelectField(entry, ["rev"], makeRenderCtx({ rev: value }));
      expect(selectedOptions(tpl)).toEqual([]);
    }
  );

  it("marks one option when several spellings present the value", () => {
    const options = ["9", "9.0", "GPIO9"].map((value) => ({ value, label: value }));
    const entry = makeEntry(ConfigEntryType.SELECT, { options });
    const tpl = renderSelectField(entry, ["pin"], makeRenderCtx({ pin: 9 }));
    expect(selectedOptions(tpl)).toEqual(["9"]);
  });

  it("keeps and selects the option a bare decimal spells when its variant is filtered out", () => {
    const options: ConfigValueOption[] = [
      { value: "2.0", label: "2.0" },
      { value: "3.0", label: "3.0", variants: ["esp32p4"] },
    ];
    const board = makeTestBoard({
      overrides: {
        esphome: {
          platform: "esp32",
          board: "b",
          variant: "esp32s3",
          framework: null,
          mcu: null,
        },
      },
    });
    const entry = makeEntry(ConfigEntryType.SELECT, { options });
    const tpl = renderSelectField(entry, ["rev"], makeRenderCtx({ rev: 3 }, { board }));
    expect(findElementBindings(tpl, "wa-option").map((b) => b.value)).toEqual([
      "2.0",
      "3.0",
    ]);
    expect(selectedOptions(tpl)).toEqual(["3.0"]);
  });
});

describe("renderSuggestionSelect — a bare YAML decimal", () => {
  it("marks the suggestion spelled for the number as selected", () => {
    const entry = makeEntry(ConfigEntryType.STRING, { suggestions: ["2.0", "3.0"] });
    const tpl = renderSuggestionSelect(
      entry,
      ["rev"],
      3,
      false,
      false,
      makeRenderCtx({})
    );
    expect(selectedOptions(tpl)).toEqual(["3.0"]);
  });
});
