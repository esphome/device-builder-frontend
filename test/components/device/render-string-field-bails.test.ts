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
import {
  renderBooleanField,
  renderFloatWithUnitField,
  renderTextareaField,
  renderTimePeriodField,
} from "../../../src/components/device/config-entry-renderers/primitives.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { getIn } from "../../../src/util/nested-values.js";
import { YamlRawValue } from "../../../src/util/yaml-serialize.js";

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
  const emitChange = vi.fn();
  const ctx: RenderCtx = {
    localize: (key) => key,
    disabled: false,
    yaml: "",
    fromLine: undefined,
    sectionKey: "",
    board: null,
    requiredOnly: false,
    nestedOpenSections: new Set(),
    getAt: (path: string[]) => getIn(values, path),
    errorAt: () => null,
    emitChange,
    toggleNested: () => {},
    requestAddComponent: () => {},
    scopeValues: () => ({}),
    filterRenderable: (entries) => entries,
    renderEntry: () => "<rendered>",
    getPendingUnit: () => undefined,
    setPendingUnit: () => {},
    getEditingMagnitude: () => undefined,
    setEditingMagnitude: () => {},
    clearEditingMagnitude: () => {},
    stashOwner: {},
  };
  return { ctx, emitChange };
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

// ``parseYamlBoolean`` returns null for non-boolean/non-string inputs,
// so a list / mapping under a boolean field renders unchecked. The
// first user toggle would then write ``true`` back and clobber the
// YAML structure. Pin both halves.
describe("renderBooleanField — bail on non-primitive", () => {
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
});
