import { describe, expect, it } from "vitest";
import type { ConfigValueOption } from "../../../src/api/types/config-entries.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import { renderSelectField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import { findTemplatesByAnchor } from "../../_lit-template-walker.js";
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

  it("forwards the default value and localized note so the menu can tag it", () => {
    const entry = makeEntry(ConfigEntryType.STRING, {
      key: "hardware_uart",
      options: BOARDS,
      allow_custom_value: true,
      default_value: "bw15",
    });
    const [b] = findElementBindings(
      renderSelectField(entry, ["hardware_uart"], makeRenderCtx({})),
      "esphome-options-combobox"
    );
    expect(b[".defaultValue"]).toBe("bw15");
    expect(b[".defaultNote"]).toBe("device.default_option_tag");
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

const UNITS: ConfigValueOption[] = [
  { value: "L", label: "L" },
  { value: "L/s", label: "L/s" },
];

function unitEntry() {
  return makeEntry(ConfigEntryType.STRING, {
    key: "unit_of_measurement",
    label: "Unit",
    options: UNITS,
    allow_custom_value: true,
  });
}

// Render the combobox for *value* and return the did-you-mean hint's localized
// text, or null when no hint renders. The ctx localize echoes the suggestion
// param so the assertion can see which canonical spelling was offered.
function hintText(value: string): string | null {
  const ctx = makeRenderCtx(
    { unit_of_measurement: value },
    { overrides: { localize: (k, v) => (v ? `${k}:${v.suggestion}` : k) } }
  );
  const tpl = renderSelectField(unitEntry(), ["unit_of_measurement"], ctx);
  const [span] = findTemplatesByAnchor(tpl, '<span class="field-warning"');
  return span ? String(span.values[0]) : null;
}

describe("renderSelectField — did-you-mean hint", () => {
  it("offers the canonical spelling for a case-only custom value", () => {
    expect(hintText("l")).toBe("validation.did_you_mean:L");
  });

  it("renders no hint for the canonical value", () => {
    expect(hintText("L")).toBeNull();
  });

  it("renders no hint for a genuinely custom unit", () => {
    expect(hintText("L/min")).toBeNull();
  });

  it("marks the hint as a polite status region so it announces to screen readers", () => {
    const ctx = makeRenderCtx({ unit_of_measurement: "l" });
    const tpl = renderSelectField(unitEntry(), ["unit_of_measurement"], ctx);
    const [span] = findTemplatesByAnchor(tpl, '<span class="field-warning"');
    expect(span.strings.join("")).toContain('role="status"');
  });
});

const BAUD_RATES: ConfigValueOption[] = [
  { value: "9600", label: "9600" },
  { value: "115200", label: "115200" },
  { value: "256000", label: "256000" },
];

function baudEntry() {
  return makeEntry(ConfigEntryType.INTEGER, {
    key: "baud_rate",
    label: "Baud Rate",
    options: BAUD_RATES,
    allow_custom_value: true,
    default_value: 115200,
  });
}

function emitCombo(value: string) {
  const ctx = makeRenderCtx({ baud_rate: 115200 });
  const [b] = findElementBindings(
    renderSelectField(baudEntry(), ["baud_rate"], ctx),
    "esphome-options-combobox"
  );
  (b["@options-combobox-change"] as (e: CustomEvent) => void)(
    new CustomEvent("options-combobox-change", { detail: { value } })
  );
  return ctx.emitChange;
}

describe("renderSelectField — numeric combobox coercion", () => {
  it("coerces a picked INTEGER baud rate to a number on emit", () => {
    expect(emitCombo("9600")).toHaveBeenCalledWith(["baud_rate"], 9600);
  });

  it("coerces a custom typed INTEGER value to a number", () => {
    expect(emitCombo("250000")).toHaveBeenCalledWith(["baud_rate"], 250000);
  });

  it("passes an empty value through unchanged so the field can be cleared", () => {
    expect(emitCombo("")).toHaveBeenCalledWith(["baud_rate"], "");
  });

  it("keeps an INTEGER above 2^53 as a string to preserve 64-bit precision", () => {
    // 2^53 + 1 — not a safe Number; coercing through Number() would round it.
    expect(emitCombo("9007199254740993")).toHaveBeenCalledWith(
      ["baud_rate"],
      "9007199254740993"
    );
  });

  it("leaves a non-numeric STRING combobox value verbatim", () => {
    const ctx = makeRenderCtx({ board: "bw15" });
    const [b] = findElementBindings(
      renderSelectField(comboEntry(), ["board"], ctx),
      "esphome-options-combobox"
    );
    (b["@options-combobox-change"] as (e: CustomEvent) => void)(
      new CustomEvent("options-combobox-change", { detail: { value: "cr3l" } })
    );
    expect(ctx.emitChange).toHaveBeenCalledWith(["board"], "cr3l");
  });
});
