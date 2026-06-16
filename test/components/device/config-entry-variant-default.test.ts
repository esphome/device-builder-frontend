import { describe, expect, it } from "vitest";
import type { BoardCatalogEntry } from "../../../src/api/types/boards.js";
import type {
  ConfigEntry,
  ConfigValueOption,
} from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderSelectField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import {
  findElementBindings,
  makeEntry,
  makeRenderCtx,
  makeTestBoard,
} from "./_renderer-fixtures.js";

// esp32's variant select has no static default; it follows the chosen board.
// The renderer derives it from the live `board:` sibling (or the saved board)
// so the board's variant shows greyed out as the default, like any other.
const VARIANT_OPTIONS: ConfigValueOption[] = [
  { value: "ESP32", label: "ESP32" },
  { value: "ESP32C6", label: "ESP32-C6" },
  { value: "ESP32S3", label: "ESP32-S3" },
];

const serialize = (tpl: unknown): string =>
  JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));

function renderVariant(
  values: unknown,
  options: {
    sectionKey?: string;
    board?: BoardCatalogEntry | null;
    default_value?: ConfigEntry["default_value"];
  } = {}
): unknown {
  const { sectionKey = "esp32", default_value = null } = options;
  const entry = makeEntry(ConfigEntryType.SELECT, {
    key: "variant",
    options: VARIANT_OPTIONS,
    default_value,
  });
  const ctxOptions: Parameters<typeof makeRenderCtx>[1] = {
    overrides: { sectionKey },
  };
  if ("board" in options) ctxOptions.board = options.board;
  return renderSelectField(entry, ["variant"], makeRenderCtx(values, ctxOptions));
}

function selectPlaceholder(tpl: unknown): unknown {
  return findElementBindings(tpl, "wa-select")[0]?.placeholder;
}

describe("renderSelectField — esp32 variant default from board", () => {
  it("derives the variant default from a live typed board", () => {
    expect(selectPlaceholder(renderVariant({ board: "esp32-c6-devkitm-1" }))).toBe(
      "ESP32-C6"
    );
  });

  it("tags the derived variant as the default option in the menu", () => {
    const json = serialize(renderVariant({ board: "esp32-c6-devkitm-1" }));
    expect(json.match(/option-default-note/g) ?? []).toHaveLength(1);
  });

  it("falls back to the saved board's variant when nothing is typed", () => {
    const board = makeTestBoard({
      overrides: {
        esphome: {
          platform: "esp32",
          board: "esp32-c6-devkitm-1",
          variant: "esp32c6",
          framework: null,
          mcu: null,
        },
      },
    });
    expect(selectPlaceholder(renderVariant({}, { board }))).toBe("ESP32-C6");
  });

  it("falls back to the static default when the board's variant isn't an option", () => {
    // esp32-s2 derives esp32s2, absent from VARIANT_OPTIONS — the membership
    // gate must reject it so a board off the option list doesn't leak through.
    expect(
      selectPlaceholder(
        renderVariant({ board: "esp32-s2-saola-1" }, { default_value: "ESP32" })
      )
    ).toBe("ESP32");
  });

  it("does not derive outside the esp32 section, so the static default wins", () => {
    expect(
      selectPlaceholder(
        renderVariant(
          { board: "esp32-c6-devkitm-1" },
          { sectionKey: "wifi", default_value: "ESP32" }
        )
      )
    ).toBe("ESP32");
  });

  it("marks nothing when there is no board and no static default", () => {
    expect(serialize(renderVariant({}, { board: null }))).not.toContain(
      "option-default-note"
    );
  });
});
