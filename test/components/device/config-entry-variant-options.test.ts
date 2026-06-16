import { describe, expect, it } from "vitest";
import type { BoardCatalogEntry } from "../../../src/api/types/boards.js";
import type { ConfigValueOption } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderSelectField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import {
  findElementBindings,
  makeEntry,
  makeRenderCtx,
  makeTestBoard,
} from "./_renderer-fixtures.js";

// A per-variant enum (psram `mode`): each value carries the ESP32 variants that
// accept it; an untagged value applies to every variant.
const MODE: ConfigValueOption[] = [
  { value: "quad", label: "quad", variants: ["esp32", "esp32s3"] },
  { value: "octal", label: "octal", variants: ["esp32s3"] },
  { value: "hex", label: "hex", variants: ["esp32p4"] },
  { value: "auto", label: "auto" },
];

function boardWithVariant(variant: string): BoardCatalogEntry {
  return makeTestBoard({
    overrides: {
      esphome: { platform: "esp32", board: "b", variant, framework: null, mcu: null },
    },
  });
}

function renderedValues(
  options: ConfigValueOption[],
  board: BoardCatalogEntry | null
): string[] {
  const entry = makeEntry(ConfigEntryType.SELECT, { key: "mode", options });
  const tpl = renderSelectField(entry, ["mode"], makeRenderCtx({}, { board }));
  return findElementBindings(tpl, "wa-option").map((b) => String(b.value));
}

describe("renderSelectField — per-variant option filtering", () => {
  it("keeps the stored value's option even when its variant no longer matches", () => {
    // mode "hex" is esp32p4-only, but the board is esp32s3 — keep it so a board
    // swap can't hide the value the YAML still holds.
    const entry = makeEntry(ConfigEntryType.SELECT, { key: "mode", options: MODE });
    const tpl = renderSelectField(
      entry,
      ["mode"],
      makeRenderCtx({ mode: "hex" }, { board: boardWithVariant("esp32s3") })
    );
    expect(findElementBindings(tpl, "wa-option").map((b) => String(b.value))).toContain(
      "hex"
    );
  });

  it("keeps the device variant's options plus untagged ones", () => {
    expect(renderedValues(MODE, boardWithVariant("esp32s3"))).toEqual([
      "quad",
      "octal",
      "auto",
    ]);
    expect(renderedValues(MODE, boardWithVariant("esp32p4"))).toEqual(["hex", "auto"]);
    expect(renderedValues(MODE, boardWithVariant("esp32"))).toEqual(["quad", "auto"]);
  });

  it("shows every option when the board variant is unknown", () => {
    expect(renderedValues(MODE, null)).toEqual(["quad", "octal", "hex", "auto"]);
  });

  it("resolves the variant from the live `board:` sibling before ctx.board", () => {
    // No saved board catalog entry yet; the just-picked `board:` value alone
    // drives filtering.
    const entry = makeEntry(ConfigEntryType.SELECT, { key: "mode", options: MODE });
    const tpl = renderSelectField(
      entry,
      ["mode"],
      makeRenderCtx({ board: "esp32-s3-devkitc-1" }, { board: null })
    );
    expect(findElementBindings(tpl, "wa-option").map((b) => String(b.value))).toEqual([
      "quad",
      "octal",
      "auto",
    ]);
  });

  it("does not filter when the resolved board isn't ESP32", () => {
    // An esp8266 board id must not accidentally filter ESP32-tagged options.
    const entry = makeEntry(ConfigEntryType.SELECT, { key: "mode", options: MODE });
    const tpl = renderSelectField(
      entry,
      ["mode"],
      makeRenderCtx({ board: "nodemcuv2" }, { board: null })
    );
    expect(findElementBindings(tpl, "wa-option").map((b) => String(b.value))).toEqual([
      "quad",
      "octal",
      "hex",
      "auto",
    ]);
  });

  it("falls back to all options when filtering would empty the select", () => {
    const strict: ConfigValueOption[] = [
      { value: "quad", label: "quad", variants: ["esp32"] },
      { value: "hex", label: "hex", variants: ["esp32p4"] },
    ];
    // esp32c3 accepts neither and there's no untagged option — show all.
    expect(renderedValues(strict, boardWithVariant("esp32c3"))).toEqual(["quad", "hex"]);
  });

  it("filters the allow_custom_value combobox options too", () => {
    const comboboxValues = (board: BoardCatalogEntry | null): string[] => {
      const entry = makeEntry(ConfigEntryType.SELECT, {
        key: "mode",
        options: MODE,
        allow_custom_value: true,
      });
      const tpl = renderSelectField(entry, ["mode"], makeRenderCtx({}, { board }));
      const combobox = findElementBindings(tpl, "esphome-options-combobox")[0];
      return (combobox[".options"] as ConfigValueOption[]).map((o) => o.value);
    };
    expect(comboboxValues(boardWithVariant("esp32s3"))).toEqual([
      "quad",
      "octal",
      "auto",
    ]);
    // Unknown variant falls back to all options, like the plain select.
    expect(comboboxValues(null)).toEqual(["quad", "octal", "hex", "auto"]);
  });
});
