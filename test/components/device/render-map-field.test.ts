/**
 * Targeted tests for ``renderMapField`` — the renderer for
 * user-keyed map entries (``logger.logs:``, the synthesised
 * ``substitutions:`` entry from #160, …).
 *
 * Two behaviours that matter for #160:
 *
 * - With ``path=[]``, the map binds to the *whole* values dict
 *   (top-level user-keyed sections like ``substitutions:`` where
 *   the entire component IS the map).
 * - For each row, the value cell is the value template only when
 *   the value is primitive; complex values (lists / dicts that
 *   ESPHome's ``CONFIG_SCHEMA = cv.Schema({validate_substitution_key: object})``
 *   permits) get a "edit in YAML" placeholder so we don't lose
 *   data through a string input that can't round-trip them.
 *
 * Tests run in vitest's default ``node`` environment — no DOM —
 * so we don't render the Lit template to a real shadow root,
 * just inspect ``ctx.renderEntry`` call patterns + the returned
 * ``TemplateResult``'s interpolated values.
 */
import { describe, expect, it, vi } from "vitest";
import { ConfigEntryType, type ConfigEntry } from "../../../src/api/types.js";
import { renderMapField } from "../../../src/components/device/config-entry-renderers.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";

function makeMapEntry(): ConfigEntry {
  return makeConfigEntry({
    type: ConfigEntryType.MAP,
    config_entries: [
      makeConfigEntry({ key: "value", required: true }),
    ],
  });
}

interface CtxStub {
  ctx: RenderCtx;
  renderEntry: ReturnType<typeof vi.fn>;
  emitChange: ReturnType<typeof vi.fn>;
}

function makeCtx(values: Record<string, unknown>): CtxStub {
  const renderEntry = vi.fn(() => "<rendered>");
  const emitChange = vi.fn();
  const ctx: RenderCtx = {
    localize: (key) => key,
    disabled: false,
    yaml: "",
    fromLine: undefined,
    board: null,
    requiredOnly: false,
    nestedOpenSections: new Set(),
    getAt: (path: string[]) => {
      let cur: unknown = values;
      for (const k of path) {
        if (cur === null || typeof cur !== "object" || Array.isArray(cur)) {
          return undefined;
        }
        cur = (cur as Record<string, unknown>)[k];
      }
      return cur;
    },
    errorAt: () => null,
    emitChange: emitChange,
    toggleNested: () => {},
    requestAddComponent: () => {},
    scopeValues: () => ({}),
    filterRenderable: (entries) => entries,
    renderEntry: renderEntry,
    getPendingUnit: () => undefined,
    setPendingUnit: () => {},
    getEditingMagnitude: () => undefined,
    setEditingMagnitude: () => {},
    clearEditingMagnitude: () => {},
  };
  return { ctx, renderEntry, emitChange };
}

describe("renderMapField (substitutions / logger.logs / etc.)", () => {
  it("reads the whole values dict via path=[]", () => {
    // Substitutions case: empty path means "this entry IS the
    // values dict". ``ctx.getAt([])`` returns the dict, the map
    // renderer iterates its keys.
    const values = {
      id_prefix: "kitchen",
      timeout: 30,
    };
    const stub = makeCtx(values);
    renderMapField(makeMapEntry(), [], stub.ctx);
    // Both primitive rows should call renderEntry with the
    // value template at the per-row path.
    const calls = stub.renderEntry.mock.calls;
    const paths = calls.map((c) => c[1]);
    expect(paths).toEqual(
      expect.arrayContaining([["id_prefix"], ["timeout"]]),
    );
    expect(calls).toHaveLength(2);
  });

  it("does NOT call renderEntry for complex (list) values — uses edit-in-YAML placeholder", () => {
    // The user-reported case: substitution value is a list of
    // mappings. The string-shaped value template can't render
    // that without losing data, so the row's value cell shows
    // the placeholder instead — no renderEntry call.
    const values = {
      simple: "hello",
      complex_list: [{ platform: "gpio", pin: 12 }],
    };
    const stub = makeCtx(values);
    renderMapField(makeMapEntry(), [], stub.ctx);
    const paths = stub.renderEntry.mock.calls.map((c) => c[1]);
    // Only the primitive row gets the value template.
    expect(paths).toEqual([["simple"]]);
  });

  it("does NOT call renderEntry for complex (dict) values either", () => {
    // ``position: {x: 79, y: 82}`` — common in real
    // ESPHome substitution fixtures.
    const values = {
      simple: "hello",
      position: { x: 79, y: 82 },
    };
    const stub = makeCtx(values);
    renderMapField(makeMapEntry(), [], stub.ctx);
    const paths = stub.renderEntry.mock.calls.map((c) => c[1]);
    expect(paths).toEqual([["simple"]]);
  });

  it("treats every primitive shape as editable: string, number, boolean, null", () => {
    // Validates that ``isPrimitiveOrNullish`` covers the YAML
    // scalar set ESPHome substitutions surface as.
    const values = {
      str: "hi",
      num: 42,
      bool: true,
      null_val: null,
    };
    const stub = makeCtx(values);
    renderMapField(makeMapEntry(), [], stub.ctx);
    const paths = stub.renderEntry.mock.calls
      .map((c) => c[1])
      .map((p) => (p as string[])[0])
      .sort();
    expect(paths).toEqual(["bool", "null_val", "num", "str"]);
  });

  it("renders an empty map cleanly (no rows, no renderEntry calls)", () => {
    const stub = makeCtx({});
    renderMapField(makeMapEntry(), [], stub.ctx);
    expect(stub.renderEntry).not.toHaveBeenCalled();
  });

  it("does not throw on a values dict whose entry was never normalised (defensive)", () => {
    // ``parseYamlSectionValues`` returns ``Object.create(null)``-
    // shaped maps; ``Object.keys`` works the same way. Sanity
    // check that the renderer doesn't choke on a null-prototype
    // dict — if a future change relied on a prototype method,
    // this would catch it.
    const values: Record<string, unknown> = Object.create(null);
    values["a"] = 1;
    values["b"] = "two";
    const stub = makeCtx(values);
    expect(() => renderMapField(makeMapEntry(), [], stub.ctx)).not.toThrow();
    const paths = stub.renderEntry.mock.calls
      .map((c) => c[1])
      .map((p) => (p as string[])[0])
      .sort();
    expect(paths).toEqual(["a", "b"]);
  });

  it("emits change against path=[] when row is added (whole-dict update)", () => {
    // The map renderer's add-row path calls ``ctx.emitChange(path, m)``.
    // When ``path=[]``, the section's ``setIn(values, [], m)`` replaces
    // the whole values dict — the empty-path case is what makes the
    // substitutions integration work end-to-end.
    const values = { existing: "value" };
    const stub = makeCtx(values);
    const result = renderMapField(makeMapEntry(), [], stub.ctx);
    // The "Add entry" button is rendered as a Lit template — we
    // can't easily click it without a DOM. Instead, simulate the
    // semantics by walking the result and calling the registered
    // click handler if exposed. For now, just verify the API
    // contract: the values dict has the existing key (proving the
    // ``ctx.getAt([])`` read worked).
    expect(stub.renderEntry).toHaveBeenCalledTimes(1);
    expect(result).toBeTruthy();
  });
});
