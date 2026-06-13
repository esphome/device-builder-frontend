import { describe, expect, it } from "vitest";
import type { ConfigValueOption } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderSelectField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import { findElementBindings, makeEntry, makeRenderCtx } from "./_renderer-fixtures.js";

const BOARDS: ConfigValueOption[] = [
  { value: "bw12", label: "bw12" },
  { value: "bw15", label: "bw15" },
];

function comboEntry() {
  return makeEntry(ConfigEntryType.STRING, {
    key: "board",
    label: "Board",
    options: BOARDS,
    allow_custom_value: true,
  });
}

describe("renderSelectField — allow_custom_value combobox", () => {
  it("renders the options-combobox seeded with the current value and options", () => {
    const tpl = renderSelectField(
      comboEntry(),
      ["board"],
      makeRenderCtx({ board: "bw15" })
    );
    const [b] = findElementBindings(tpl, "esphome-options-combobox");
    expect(b[".options"]).toEqual(BOARDS);
    expect(b[".value"]).toBe("bw15");
    expect(b["label"]).toBe("Board");
  });

  it("wires options-combobox-change to emitChange, including a custom typed value", () => {
    const ctx = makeRenderCtx({ board: "bw15" });
    const tpl = renderSelectField(comboEntry(), ["board"], ctx);
    const [b] = findElementBindings(tpl, "esphome-options-combobox");
    (b["@options-combobox-change"] as (e: CustomEvent) => void)(
      new CustomEvent("options-combobox-change", { detail: { value: "cr3l" } })
    );
    expect(ctx.emitChange).toHaveBeenCalledWith(["board"], "cr3l");
  });

  it("passes invalid and disabled through to the combobox", () => {
    const ctx = makeRenderCtx(
      { board: "bw15" },
      { overrides: { disabled: true, errorAt: () => ({ message: "bad" }) as never } }
    );
    const [b] = findElementBindings(
      renderSelectField(comboEntry(), ["board"], ctx),
      "esphome-options-combobox"
    );
    expect(b["?disabled"]).toBe(true);
    expect(b["?invalid"]).toBe(true);
  });

  it("uses a strict wa-select (not the combobox) when allow_custom_value is unset", () => {
    const entry = makeEntry(ConfigEntryType.STRING, { key: "board", options: BOARDS });
    const tpl = renderSelectField(entry, ["board"], makeRenderCtx({ board: "bw15" }));
    expect(findElementBindings(tpl, "esphome-options-combobox")).toHaveLength(0);
    expect(findElementBindings(tpl, "wa-select")).toHaveLength(1);
  });
});
