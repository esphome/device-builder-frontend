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
import { ConfigEntryType, type ConfigEntry } from "../../../src/api/types.js";
import { renderStringField } from "../../../src/components/device/config-entry-renderers-shared.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";

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
    getAt: (path: string[]) => {
      let cur: unknown = values;
      for (const k of path) {
        if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
          if (path.indexOf(k) === path.length - 1 && Array.isArray(cur)) return cur;
          return undefined;
        }
        cur = (cur as Record<string, unknown>)[k];
      }
      return cur;
    },
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
    expect(json).toContain("device.multi_value_yaml_only");
    // No editable <input type="text"> mounted.
    expect(json).not.toContain('"text"');
  });

  it("renders a YAML-only notice when the value is a mapping", () => {
    const { ctx } = makeCtx({
      calibration: { b_constant: 3950, reference_temperature: 25 },
    });
    const tpl = renderStringField(makeStringEntry(), "text", ["calibration"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(json).toContain("device.multi_value_yaml_only");
  });

  it("renders the editable input for actual strings", () => {
    const { ctx } = makeCtx({ calibration: "hello" });
    const tpl = renderStringField(makeStringEntry(), "text", ["calibration"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(json).not.toContain("device.multi_value_yaml_only");
    expect(json).toContain("hello");
  });

  it("renders the editable input for null / undefined (treated as empty)", () => {
    const { ctx } = makeCtx({ calibration: null });
    const tpl = renderStringField(makeStringEntry(), "text", ["calibration"], ctx);
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(json).not.toContain("device.multi_value_yaml_only");
  });
});
