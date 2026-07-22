/**
 * Targeted tests for ``renderStringField``'s defensive bail when the
 * value at *path* isn't a primitive (a list landed under a mapping-
 * shaped catalog field because the upstream schema bundle missed
 * ``is_list``, an inline mapping under a scalar-shaped field). The
 * pre-fix renderer ran ``String(ctx.getAt(path) ?? "")`` which
 * silently coerced the list to a comma-joined string; saving wrote
 * that string back and clobbered the user's list.
 */
import { describe, expect, it, vi } from "vitest";
import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { renderStringField } from "../../../src/components/device/config-entry-renderers-shared.js";
import { renderMultiValueField } from "../../../src/components/device/config-entry-renderers/lists.js";
import {
  renderBooleanField,
  renderFloatWithUnitField,
  renderNumberField,
  renderTextareaField,
  renderTimePeriodField,
} from "../../../src/components/device/config-entry-renderers/primitives.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { YamlRawValue } from "../../../src/util/yaml-serialize.js";
import { findElementBindings, makeEmitCtx, makeRenderCtx } from "./_renderer-fixtures.js";

function makeStringEntry(): ConfigEntry {
  return makeConfigEntry({
    key: "calibration",
    type: ConfigEntryType.STRING,
    label: "Calibration",
  });
}

function makeCtx(values: Record<string, unknown>): {
  ctx: RenderCtx;
  emitChange: ReturnType<typeof vi.fn>;
} {
  return makeEmitCtx(values, { renderEntry: () => "<rendered>" });
}

/** The bail branch is the only one that emits a ``<p class="field-description">``
 *  containing the YAML-only translation key; the editable branch emits an
 *  ``<input>`` whose binding includes a ``placeholder`` attribute. Key the
 *  branch checks off those bail-specific markers so a future renderer change
 *  (different ``inputType``, restructured input element) doesn't silently
 *  false-pass. */
function rendersBailBranch(json: string): boolean {
  return json.includes("device.value_yaml_only") && json.includes("field-description");
}

function rendersEditableBranch(json: string): boolean {
  return json.includes("placeholder") && !json.includes("device.value_yaml_only");
}

describe("renderStringField — defensive bail on non-primitive values", () => {
  it("renders a YAML-only notice when the value is a list", () => {
    // to_ntc_resistance.calibration shape: the schema bundle drops
    // is_list on the field because the upstream validator is a
    // custom callable, so the catalog emits type=string and the
    // YAML carries a list of strings. Bail rather than coerce.
    const { ctx } = makeCtx({
      calibration: ["10.0kOhm -> 25°C", "27.219kOhm -> 0°C"],
    });
    const tpl = renderStringField(makeStringEntry(), "text", ["calibration"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(true);
    expect(rendersEditableBranch(json)).toBe(false);
  });

  it("renders a YAML-only notice when the value is a mapping", () => {
    const { ctx } = makeCtx({
      calibration: { b_constant: 3950, reference_temperature: 25 },
    });
    const tpl = renderStringField(makeStringEntry(), "text", ["calibration"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(true);
    expect(rendersEditableBranch(json)).toBe(false);
  });

  it("renders the editable input for actual strings", () => {
    const { ctx } = makeCtx({ calibration: "hello" });
    const tpl = renderStringField(makeStringEntry(), "text", ["calibration"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersEditableBranch(json)).toBe(true);
    expect(rendersBailBranch(json)).toBe(false);
    expect(json).toContain("hello");
  });

  it("renders the editable input for null / undefined (treated as empty)", () => {
    const { ctx } = makeCtx({ calibration: null });
    const tpl = renderStringField(makeStringEntry(), "text", ["calibration"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersEditableBranch(json)).toBe(true);
    expect(rendersBailBranch(json)).toBe(false);
  });
});

function makeTextareaEntry(): ConfigEntry {
  return makeConfigEntry({
    key: "lambda",
    type: ConfigEntryType.LAMBDA,
    label: "Lambda",
  });
}

// The textarea bail is conditional on ``!isRaw`` — a ``YamlRawValue``
// is an intentional block-scalar (``|-`` / ``>-`` etc.) and must still
// reach the textarea so the user can edit the body. The two cases
// below pin that asymmetry so a future reorder of the bail / isRaw
// check can't silently regress the lambda editor.
describe("renderTextareaField — bail asymmetry with YamlRawValue", () => {
  it("renders the textarea for a YamlRawValue (block scalar)", () => {
    const raw = new YamlRawValue(["  return x;"], "|-");
    const { ctx } = makeCtx({ lambda: raw });
    const tpl = renderTextareaField(makeTextareaEntry(), ["lambda"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(false);
    expect(json).toContain("textarea");
  });

  it("bails when the value is a list under a textarea field", () => {
    const { ctx } = makeCtx({ lambda: ["a", "b"] });
    const tpl = renderTextareaField(makeTextareaEntry(), ["lambda"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(true);
    expect(json).not.toContain("textarea");
  });
});

// parseTimePeriod / parseFloatWithUnit both run ``String(raw).trim()``
// internally — a single-element list like ``["5s"]`` or ``["50Hz"]``
// would otherwise stringify to a parseable scalar, render an editable
// UI, and clobber the original list on save. Pin both call-sites.
describe("renderTimePeriodField / renderFloatWithUnitField — bail on non-primitive", () => {
  it("bails on a list value for a time-period field", () => {
    const entry = makeConfigEntry({
      key: "delay",
      type: ConfigEntryType.TIME_PERIOD,
      label: "Delay",
    });
    const { ctx } = makeCtx({ delay: ["5s"] });
    const tpl = renderTimePeriodField(entry, ["delay"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(true);
  });

  it("bails on a boolean under a time-period field", () => {
    const entry = makeConfigEntry({
      key: "delay",
      type: ConfigEntryType.TIME_PERIOD,
      label: "Delay",
    });
    const { ctx } = makeCtx({ delay: true });
    const tpl = renderTimePeriodField(entry, ["delay"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(true);
  });

  it("keeps a compound duration string editable as text", () => {
    const entry = makeConfigEntry({
      key: "delay",
      type: ConfigEntryType.TIME_PERIOD,
      label: "Delay",
    });
    const { ctx } = makeCtx({ delay: "1h30m" });
    const tpl = renderTimePeriodField(entry, ["delay"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(false);
    expect(json).toContain("1h30m");
  });

  it("renders the editable time-period UI for an actual scalar", () => {
    const entry = makeConfigEntry({
      key: "delay",
      type: ConfigEntryType.TIME_PERIOD,
      label: "Delay",
    });
    const { ctx } = makeCtx({ delay: "5s" });
    const tpl = renderTimePeriodField(entry, ["delay"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(false);
    expect(json).toContain("time-period");
  });

  it("renders the split UI for an aliased unit (1sec), not the text fallback", () => {
    const entry = makeConfigEntry({
      key: "delay",
      type: ConfigEntryType.TIME_PERIOD,
      label: "Delay",
    });
    const { ctx } = makeCtx({ delay: "1sec" });
    const tpl = renderTimePeriodField(entry, ["delay"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(json).toContain("time-period");
    expect(json).toContain('"1"');
  });

  it("bails on a list value for a float-with-unit field", () => {
    const entry = makeConfigEntry({
      key: "frequency",
      type: ConfigEntryType.FLOAT_WITH_UNIT,
      label: "Frequency",
      unit_options: ["Hz", "kHz", "MHz"],
    });
    const { ctx } = makeCtx({ frequency: ["50Hz"] });
    const tpl = renderFloatWithUnitField(entry, ["frequency"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(true);
  });

  it("renders the editable float-with-unit UI for an actual scalar", () => {
    const entry = makeConfigEntry({
      key: "frequency",
      type: ConfigEntryType.FLOAT_WITH_UNIT,
      label: "Frequency",
      unit_options: ["Hz", "kHz", "MHz"],
    });
    const { ctx } = makeCtx({ frequency: "50Hz" });
    const tpl = renderFloatWithUnitField(entry, ["frequency"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(false);
  });
});

// <input type="number"> silently blanks a non-numeric .value, so an
// unparseable primitive under a FLOAT field ("250 steps/s" before the
// catalog carried the unit) read as unset, and the first keystroke wrote
// a bare number over it. Same class in the with-unit renderer: a value
// the parser can't split ("21C") rendered an empty magnitude + unit
// picker. Both bail to the YAML-only notice (#2056).
describe("renderNumberField / renderFloatWithUnitField — bail on unparseable primitive", () => {
  const floatEntry = (): ConfigEntry =>
    makeConfigEntry({
      key: "max_speed",
      type: ConfigEntryType.FLOAT,
      label: "Max Speed",
    });

  const withUnitEntry = (): ConfigEntry =>
    makeConfigEntry({
      key: "default_target_temperature",
      type: ConfigEntryType.FLOAT_WITH_UNIT,
      label: "Default Target Temperature",
      unit_options: ["°C", "°F", "K"],
    });

  it("renders editable text for a unit-suffixed string under a FLOAT field", () => {
    // A junk string edits in place with its validation error rather than
    // locking behind the YAML-only shell (#1352's call for list rows).
    const { ctx } = makeCtx({ max_speed: "250 steps/s" });
    const tpl = renderNumberField(floatEntry(), ["max_speed"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(false);
    expect(json).toContain("250 steps/s");
  });

  it("renders editable text for a stored non-finite string under a FLOAT field", () => {
    const { ctx } = makeCtx({ max_speed: "1e309" });
    const tpl = renderNumberField(floatEntry(), ["max_speed"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(false);
    expect(json).toContain("1e309");
  });

  it("bails on a boolean under a FLOAT field", () => {
    const { ctx } = makeCtx({ max_speed: true });
    const tpl = renderNumberField(floatEntry(), ["max_speed"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(true);
  });

  it("renders the number input for a number and a numeric string", () => {
    for (const value of [250, "250"]) {
      const { ctx } = makeCtx({ max_speed: value });
      const tpl = renderNumberField(floatEntry(), ["max_speed"], ctx);
      const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
      expect(rendersBailBranch(json)).toBe(false);
      expect(rendersEditableBranch(json)).toBe(true);
    }
  });

  it("renders the number input when the value is unset", () => {
    const { ctx } = makeCtx({});
    const tpl = renderNumberField(floatEntry(), ["max_speed"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(false);
    expect(rendersEditableBranch(json)).toBe(true);
  });

  it("renders editable text for a malformed unit string under a float-with-unit field", () => {
    const { ctx } = makeCtx({ default_target_temperature: "21X" });
    const tpl = renderFloatWithUnitField(
      withUnitEntry(),
      ["default_target_temperature"],
      ctx
    );
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(false);
    expect(json).toContain("21X");
  });

  it("bails on a boolean under a float-with-unit field", () => {
    const { ctx } = makeCtx({ default_target_temperature: true });
    const tpl = renderFloatWithUnitField(
      withUnitEntry(),
      ["default_target_temperature"],
      ctx
    );
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(true);
  });

  it("keeps a degree-less temperature spelling editable (21C is valid upstream)", () => {
    const { ctx } = makeCtx({ default_target_temperature: "21C" });
    const tpl = renderFloatWithUnitField(
      withUnitEntry(),
      ["default_target_temperature"],
      ctx
    );
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(false);
  });

  it("renders both fields as editable text for a ${substitution} value", () => {
    // The validator skips numeric checks for substitution refs; the
    // renderer must keep them editable, not lock them behind the notice.
    const floatCtx = makeCtx({ max_speed: "${speed}" }).ctx;
    const floatJson = JSON.stringify(
      renderNumberField(floatEntry(), ["max_speed"], floatCtx),
      (k, v) => (k === "_$litType$" ? 0 : v)
    );
    expect(rendersBailBranch(floatJson)).toBe(false);
    expect(floatJson).toContain("${speed}");

    const unitCtx = makeCtx({ default_target_temperature: "${target}" }).ctx;
    const unitJson = JSON.stringify(
      renderFloatWithUnitField(withUnitEntry(), ["default_target_temperature"], unitCtx),
      (k, v) => (k === "_$litType$" ? 0 : v)
    );
    expect(rendersBailBranch(unitJson)).toBe(false);
    expect(unitJson).toContain("${target}");
  });

  it("keeps the editable UI mid-edit even when the committed value is empty", () => {
    const ctx = makeRenderCtx(
      { default_target_temperature: "1e" },
      {
        board: null,
        overrides: {
          emitChange: vi.fn(),
          renderEntry: () => "<rendered>",
          getEditingMagnitude: () => "1e",
        },
      }
    );
    const tpl = renderFloatWithUnitField(
      withUnitEntry(),
      ["default_target_temperature"],
      ctx
    );
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(false);
  });

  it("renders the editable float-with-unit UI for a well-formed value and for unset", () => {
    // A whitespace-only value is effectively unset, never a bail.
    for (const values of [
      { default_target_temperature: "21°C" },
      { default_target_temperature: " " },
      {},
    ]) {
      const { ctx } = makeCtx(values);
      const tpl = renderFloatWithUnitField(
        withUnitEntry(),
        ["default_target_temperature"],
        ctx
      );
      const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
      expect(rendersBailBranch(json)).toBe(false);
    }
  });
});

// A backend list-of-dicts the schema bundle couldn't type as nested can
// arrive as multi_value=true with scalar type (a light's ``segments``).
// The scalar-row editor would render "[object Object]" per item and a
// save would clobber the dicts, so it bails to the YAML-only notice.
describe("renderMultiValueField — bail when items are mappings", () => {
  const entry = (): ConfigEntry =>
    makeConfigEntry({
      key: "segments",
      type: ConfigEntryType.STRING,
      label: "Segments",
      multi_value: true,
    });

  it("renders editable rows for a list of scalars", () => {
    const { ctx } = makeCtx({ segments: ["ON for 1s", "OFF for 500ms"] });
    const tpl = renderMultiValueField(entry(), ["segments"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(false);
    expect(json).toContain("multi-input");
  });

  it("bails when an item is a mapping", () => {
    const { ctx } = makeCtx({ segments: [{ id: "a", from: 0, to: 10 }] });
    const tpl = renderMultiValueField(entry(), ["segments"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(true);
    expect(json).not.toContain("multi-input");
  });
});

// ``parseYamlBoolean`` returns null for anything but a boolean or a
// boolean spelling, and the first toggle of an unchecked switch would
// write ``true`` over the stored value. Pin every bail branch: lists /
// mappings and stray numbers to the YAML-only notice, substitution and
// junk strings to editable text (#1368).
describe("renderBooleanField — bail branches", () => {
  const entry = (): ConfigEntry =>
    makeConfigEntry({ key: "enabled", type: ConfigEntryType.BOOLEAN, label: "Enabled" });

  it("bails when the value is a list under a boolean field", () => {
    const { ctx } = makeCtx({ enabled: [true] });
    const tpl = renderBooleanField(entry(), ["enabled"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(true);
    expect(json).not.toContain("wa-switch");
  });

  it("renders the switch for an actual boolean", () => {
    const { ctx } = makeCtx({ enabled: true });
    const tpl = renderBooleanField(entry(), ["enabled"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(false);
    expect(json).toContain("wa-switch");
  });

  it("renders editable text for a substitution or junk string (no switch to clobber it)", () => {
    for (const value of ["${my_mode}", "maybe"]) {
      const { ctx } = makeCtx({ enabled: value });
      const tpl = renderBooleanField(entry(), ["enabled"], ctx);
      const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
      expect(rendersBailBranch(json)).toBe(false);
      expect(json).not.toContain("wa-switch");
      expect(json).toContain(value);
    }
  });

  it("bails on a stray number under a boolean field", () => {
    const { ctx } = makeCtx({ enabled: 1 });
    const tpl = renderBooleanField(entry(), ["enabled"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(rendersBailBranch(json)).toBe(true);
    expect(json).not.toContain("wa-switch");
  });

  it("coerces a corrected boolean spelling back to a real boolean on emit", () => {
    const { ctx, emitChange } = makeCtx({ enabled: "${my_mode}" });
    const tpl = renderBooleanField(entry(), ["enabled"], ctx);
    const handler = findElementBindings(tpl, "input")[0]["@input"] as (
      e: unknown
    ) => void;
    handler({ target: { value: "false" } });
    expect(emitChange).toHaveBeenCalledWith(["enabled"], false);
    handler({ target: { value: "maybe" } });
    expect(emitChange).toHaveBeenCalledWith(["enabled"], "maybe");
    handler({ target: { value: " off " } });
    expect(emitChange).toHaveBeenCalledWith(["enabled"], false);
    handler({ target: { value: "  " } });
    expect(emitChange).toHaveBeenCalledWith(["enabled"], "");
  });

  it("renders the switch for a whitespace-padded spelling", () => {
    const { ctx } = makeCtx({ enabled: " yes " });
    const tpl = renderBooleanField(entry(), ["enabled"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(json).toContain("wa-switch");
  });

  it("keeps the switch for quoted boolean spellings and empty placeholder", () => {
    for (const value of ["off", ""]) {
      const { ctx } = makeCtx({ enabled: value });
      const tpl = renderBooleanField(entry(), ["enabled"], ctx);
      const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
      expect(json).toContain("wa-switch");
    }
  });
});
