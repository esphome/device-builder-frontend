/**
 * Pins that plain INTEGER fields render a text input accepting decimal
 * or hex (ESPHome's ``cv.int_`` takes both) and emit the value verbatim
 * so the user's notation round-trips (4369 stays 4369; 0x1111 stays
 * 0x1111). Floats keep the native number input; the ``display_format:
 * "hex"`` path keeps canonicalizing.
 */
import { describe, expect, it, vi } from "vitest";
import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { renderNumberField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";
import {
  findElementBindings,
  fireInput,
  makeEmitCtx,
  makeRenderCtx,
} from "./_renderer-fixtures.js";

/** The literal HTML of the rendered ``<input>`` (static strings, real quotes). */
const inputHtml = (tpl: unknown): string =>
  findTemplatesByAnchor(tpl, "<input")[0].strings.join("");

/** The ``.value`` property bound on the rendered input. */
const inputValue = (tpl: unknown): unknown =>
  findElementBindings(tpl, "input")[0][".value"];

function intEntry(overrides: Partial<ConfigEntry> = {}): ConfigEntry {
  return makeConfigEntry({
    key: "address",
    type: ConfigEntryType.INTEGER,
    label: "Address",
    ...overrides,
  });
}

describe("renderNumberField — integer fields accept decimal or hex", () => {
  it("renders a text input (not a number spinner) for integers", () => {
    const { ctx } = makeEmitCtx({ address: "0x1111" });
    const html = inputHtml(renderNumberField(intEntry(), ["address"], ctx));
    expect(html).toContain('type="text"');
    expect(html).not.toContain('type="number"');
  });

  it("displays the stored value verbatim — hex stays hex", () => {
    const { ctx } = makeEmitCtx({ address: "0x1111" });
    expect(inputValue(renderNumberField(intEntry(), ["address"], ctx))).toBe("0x1111");
  });

  it("emits decimal input as a number (so YAML stays bare, not quoted)", () => {
    const { ctx, emitChange } = makeEmitCtx({ address: "" });
    fireInput(renderNumberField(intEntry(), ["address"], ctx), "434343");
    expect(emitChange).toHaveBeenCalledWith(["address"], 434343);
  });

  it("emits hex input verbatim as a string (no canonicalization)", () => {
    const { ctx, emitChange } = makeEmitCtx({ address: "" });
    fireInput(renderNumberField(intEntry(), ["address"], ctx), "0x2A");
    expect(emitChange).toHaveBeenCalledWith(["address"], "0x2A");
  });

  it("emits a negative decimal as a number (stays bare, not quoted)", () => {
    const { ctx, emitChange } = makeEmitCtx({ offset: "" });
    const entry = intEntry({ key: "offset" });
    fireInput(renderNumberField(entry, ["offset"], ctx), "-5");
    expect(emitChange).toHaveBeenCalledWith(["offset"], -5);
  });

  it("trims surrounding whitespace and emits empty for a blank value", () => {
    const { ctx, emitChange } = makeEmitCtx({ address: "" });
    fireInput(renderNumberField(intEntry(), ["address"], ctx), "  4369  ");
    expect(emitChange).toHaveBeenCalledWith(["address"], 4369);
    fireInput(renderNumberField(intEntry(), ["address"], ctx), "");
    expect(emitChange).toHaveBeenCalledWith(["address"], "");
  });

  it("mirrors raw keystrokes into the edit buffer (so reformatting doesn't fight the cursor)", () => {
    const setEditingMagnitude = vi.fn();
    const ctx = makeRenderCtx(
      { address: "" },
      { board: null, overrides: { emitChange: vi.fn(), setEditingMagnitude } }
    );
    fireInput(renderNumberField(intEntry(), ["address"], ctx), "0042");
    expect(setEditingMagnitude).toHaveBeenCalledWith(["address"], "0042");
  });

  it("shows the edit buffer verbatim while it is set, overriding the committed value", () => {
    const ctx = makeRenderCtx(
      { address: 42 },
      { board: null, overrides: { getEditingMagnitude: () => "0042" } }
    );
    expect(inputValue(renderNumberField(intEntry(), ["address"], ctx))).toBe("0042");
  });

  it("keeps a 64-bit decimal as a string (precision past 2^53)", () => {
    const { ctx, emitChange } = makeEmitCtx({ address: "" });
    fireInput(renderNumberField(intEntry(), ["address"], ctx), "18446744073709551615");
    expect(emitChange).toHaveBeenCalledWith(["address"], "18446744073709551615");
  });

  it("leaves the display_format:hex path canonicalizing", () => {
    const { ctx, emitChange } = makeEmitCtx({ rom: "" });
    const entry = intEntry({ key: "rom", display_format: "hex" });
    fireInput(renderNumberField(entry, ["rom"], ctx), "118");
    expect(emitChange).toHaveBeenCalledWith(["rom"], "0x76");
  });
});

describe("renderNumberField — float fields", () => {
  const floatEntry = (): ConfigEntry =>
    makeConfigEntry({
      key: "gain",
      type: ConfigEntryType.FLOAT,
      label: "Gain",
    });

  it("keeps the native number input and coerces to a number", () => {
    const { ctx, emitChange } = makeEmitCtx({ gain: "1.5" });
    const tpl = renderNumberField(floatEntry(), ["gain"], ctx);
    expect(inputHtml(tpl)).toContain('type="number"');
    fireInput(tpl, "2.5");
    expect(emitChange).toHaveBeenCalledWith(["gain"], 2.5);
  });

  it("keeps non-finite input verbatim (never Infinity)", () => {
    const { ctx, emitChange } = makeEmitCtx({ gain: "" });
    fireInput(renderNumberField(floatEntry(), ["gain"], ctx), "1e309");
    expect(emitChange).toHaveBeenCalledWith(["gain"], "1e309");
    fireInput(renderNumberField(floatEntry(), ["gain"], ctx), "");
    expect(emitChange).toHaveBeenCalledWith(["gain"], "");
  });

  it("treats whitespace-only input as blank, not 0", () => {
    const { ctx, emitChange } = makeEmitCtx({ gain: "" });
    fireInput(renderNumberField(floatEntry(), ["gain"], ctx), "   ");
    expect(emitChange).toHaveBeenCalledWith(["gain"], "");
  });

  it("coerces a corrected value from the junk-value text field back to a number", () => {
    const { ctx, emitChange } = makeEmitCtx({ gain: "1e309" });
    const tpl = renderNumberField(floatEntry(), ["gain"], ctx);
    fireInput(tpl, "50");
    expect(emitChange).toHaveBeenCalledWith(["gain"], 50);
    fireInput(tpl, "${speed}");
    expect(emitChange).toHaveBeenCalledWith(["gain"], "${speed}");
  });
});
