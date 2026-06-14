/**
 * Pins that ``renderStringField``'s single-line input opts out of browser
 * autofill (``autocomplete="off"``) so an api/ota/wifi password elsewhere
 * in the form doesn't trigger password autocomplete on the ID input.
 */
import { describe, expect, it, vi } from "vitest";
import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { renderStringField } from "../../../src/components/device/config-entry-renderers-shared.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";
import { makeRenderCtx } from "./_renderer-fixtures.js";

function ctxFor(value: string): RenderCtx {
  return makeRenderCtx(
    { id: value },
    { board: null, overrides: { emitChange: vi.fn() } }
  );
}

function makeEntry(): ConfigEntry {
  return makeConfigEntry({ key: "id", type: ConfigEntryType.STRING, label: "ID" });
}

describe("renderStringField — autocomplete", () => {
  it("renders the text input with autocomplete off", () => {
    const tpl = renderStringField(makeEntry(), "text", ["id"], ctxFor("ld2410_radar"));
    const [input] = findTemplatesByAnchor(tpl, "<input");
    expect(input.strings.join("")).toContain('autocomplete="off"');
  });
});
