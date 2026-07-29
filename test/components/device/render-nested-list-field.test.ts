/**
 * Targeted tests for ``renderNestedListField`` — the renderer for
 * repeatable nested mappings (``esphome.devices``,
 * ``esphome.areas``, …; the catalog flag is
 * ``type=nested, multi_value=true``).
 *
 * Two behaviours that matter for #434:
 *
 * - Each item is rendered as its own group with the same children
 *   as a single nested entry; child paths land at
 *   ``[..., "0", child.key]`` so the array slot survives writes.
 * - Add / remove handlers emit the whole new array at the field's
 *   path. Existing items keep identity so structural sharing in
 *   the form-state reducer holds.
 *
 * Tests run in vitest's default ``node`` environment — no DOM —
 * so we don't render the Lit template to a real shadow root, just
 * inspect ``ctx.renderEntry`` call patterns + the returned
 * ``TemplateResult``'s interpolated values.
 */
import { describe, expect, it, vi } from "vitest";
import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { renderNestedListField } from "../../../src/components/device/config-entry-renderers.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { YamlRawValue } from "../../../src/util/yaml-serialize.js";
import { normalizeMaybeValues } from "../../../src/util/maybe-values.js";
import { makeRenderCtx } from "./_renderer-fixtures.js";

function makeListEntry(): ConfigEntry {
  return makeConfigEntry({
    key: "devices",
    type: ConfigEntryType.NESTED,
    multi_value: true,
    config_entries: [
      makeConfigEntry({ key: "id", type: ConfigEntryType.ID, required: true }),
      makeConfigEntry({ key: "name", type: ConfigEntryType.STRING }),
      makeConfigEntry({ key: "area_id", type: ConfigEntryType.ID }),
    ],
  });
}

interface CtxStub {
  ctx: RenderCtx;
  renderEntry: ReturnType<typeof vi.fn>;
  emitChange: ReturnType<typeof vi.fn>;
  filterRenderable: ReturnType<typeof vi.fn>;
}

function collectHandlers(values: unknown[]): Array<(...args: unknown[]) => unknown> {
  const out: Array<(...args: unknown[]) => unknown> = [];
  const walk = (v: unknown): void => {
    if (typeof v === "function") {
      out.push(v as (...args: unknown[]) => unknown);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object" && "values" in v) {
      walk((v as { values: unknown[] }).values);
    }
  };
  walk(values);
  return out;
}

function makeCtx(values: Record<string, unknown>): CtxStub {
  const renderEntry = vi.fn(() => "<rendered>");
  const emitChange = vi.fn();
  const filterRenderable = vi.fn((entries: ConfigEntry[]) => entries);
  const ctx = makeRenderCtx(values, {
    board: null,
    overrides: { emitChange, renderEntry, filterRenderable },
  });
  return { ctx, renderEntry, emitChange, filterRenderable };
}

describe("renderNestedListField", () => {
  it("renders one child set per item at array-indexed paths", () => {
    const entry = makeListEntry();
    const { ctx, renderEntry } = makeCtx({
      devices: [
        { id: "front_door", name: "Front Door" },
        { id: "kitchen", name: "Kitchen" },
      ],
    });

    renderNestedListField(entry, ["devices"], ctx);

    // Each of the 3 child entries gets rendered for each of the 2 items.
    expect(renderEntry).toHaveBeenCalledTimes(6);
    const paths = renderEntry.mock.calls.map((c) => c[1]);
    expect(paths).toContainEqual(["devices", "0", "id"]);
    expect(paths).toContainEqual(["devices", "0", "name"]);
    expect(paths).toContainEqual(["devices", "0", "area_id"]);
    expect(paths).toContainEqual(["devices", "1", "id"]);
    expect(paths).toContainEqual(["devices", "1", "name"]);
    expect(paths).toContainEqual(["devices", "1", "area_id"]);
  });

  it("renders no items and the empty hint when the array is missing", () => {
    const entry = makeListEntry();
    const { ctx, renderEntry } = makeCtx({});
    const tpl = renderNestedListField(entry, ["devices"], ctx);
    expect(renderEntry).not.toHaveBeenCalled();
    // The empty-state translation key is rendered as a literal in
    // the template values. Walk values to find it.
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(json).toContain("device.multi_value_empty");
  });

  it("addItem seeds a unique id when the row schema requires one (#2452)", () => {
    const entry = makeListEntry();
    const { ctx, emitChange } = makeCtx({
      devices: [{ id: "kitchen" }],
    });
    const tpl = renderNestedListField(entry, ["devices"], ctx);
    const handlers = collectHandlers(tpl.values);
    // Last handler in render order is the add button (rendered after
    // the items + their per-item remove buttons).
    handlers[handlers.length - 1]();
    expect(emitChange).toHaveBeenCalledWith(
      ["devices"],
      [{ id: "kitchen" }, { id: "devices_1" }]
    );
  });

  it("seeded id increments past document ids and unflushed sibling rows", () => {
    const entry = makeListEntry();
    const renderEntry = vi.fn(() => "<rendered>");
    const emitChange = vi.fn();
    const filterRenderable = vi.fn((entries: ConfigEntry[]) => entries);
    const ctx = makeRenderCtx(
      { devices: [{ id: "devices_2" }] },
      {
        board: null,
        overrides: {
          emitChange,
          renderEntry,
          filterRenderable,
          yaml: "esphome:\n  devices:\n    - id: devices_1\n",
        },
      }
    );
    const tpl = renderNestedListField(entry, ["devices"], ctx);
    collectHandlers(tpl.values).pop()!();
    expect(emitChange).toHaveBeenCalledWith(
      ["devices"],
      [{ id: "devices_2" }, { id: "devices_3" }]
    );
  });

  it("seeded id sees a same-key sibling list under a different parent row", () => {
    // esp32_ble_server: every services[] row has its own characteristics[]
    // list; an id minted in one must not collide with an unflushed id in
    // the other.
    const entry = makeConfigEntry({
      key: "characteristics",
      type: ConfigEntryType.NESTED,
      multi_value: true,
      config_entries: [
        makeConfigEntry({ key: "id", type: ConfigEntryType.ID, required: true }),
      ],
    });
    const { ctx, emitChange } = makeCtx({
      services: [
        { characteristics: [{ id: "characteristics_1" }] },
        { characteristics: [] },
      ],
    });
    const tpl = renderNestedListField(entry, ["services", "1", "characteristics"], ctx);
    collectHandlers(tpl.values).pop()!();
    expect(emitChange).toHaveBeenCalledWith(
      ["services", "1", "characteristics"],
      [{ id: "characteristics_2" }]
    );
  });

  it("addItem appends a bare {} when no child requires a declaring id", () => {
    const entry = makeConfigEntry({
      key: "devices",
      type: ConfigEntryType.NESTED,
      multi_value: true,
      config_entries: [
        makeConfigEntry({ key: "id", type: ConfigEntryType.ID }),
        makeConfigEntry({
          key: "uart_id",
          type: ConfigEntryType.ID,
          required: true,
          references_component: "uart",
        }),
      ],
    });
    const { ctx, emitChange } = makeCtx({ devices: [] });
    const tpl = renderNestedListField(entry, ["devices"], ctx);
    collectHandlers(tpl.values).pop()!();
    // The optional id stays unseeded; the required reference is a picker,
    // not a declaration.
    expect(emitChange).toHaveBeenCalledWith(["devices"], [{}]);
  });

  it("removeAt drops the item at idx and emits the new array", () => {
    const entry = makeListEntry();
    const before = { devices: [{ id: "a" }, { id: "b" }, { id: "c" }] };
    const { ctx, emitChange } = makeCtx(before);
    const tpl = renderNestedListField(entry, ["devices"], ctx);
    // Handlers are emitted in render order: per-item remove (3 of
    // them, one per item), then the add button. Pick the second
    // remove handler (idx 1) and invoke it.
    const handlers = collectHandlers(tpl.values);
    expect(handlers).toHaveLength(4);
    handlers[1]();
    expect(emitChange).toHaveBeenCalledWith(["devices"], [{ id: "a" }, { id: "c" }]);
    // Untouched siblings preserve identity.
    const next = emitChange.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(next[0]).toBe(before.devices[0]);
    expect(next[1]).toBe(before.devices[2]);
  });

  it("filterRenderable receives the per-item values for depends_on resolution", () => {
    const entry = makeListEntry();
    const { ctx, filterRenderable } = makeCtx({
      devices: [{ id: "front" }, { id: "kitchen", area_id: "main" }],
    });
    renderNestedListField(entry, ["devices"], ctx);
    // One call per item, with the *item* (not the parent dict) as
    // the scoping values.
    expect(filterRenderable).toHaveBeenCalledTimes(2);
    expect(filterRenderable.mock.calls[0][1]).toEqual({ id: "front" });
    expect(filterRenderable.mock.calls[1][1]).toEqual({
      id: "kitchen",
      area_id: "main",
    });
  });

  it("coerces non-object items to {} so the renderer never crashes", () => {
    // js-yaml can briefly emit ``null`` items mid-edit (a stray ``-``
    // line). The renderer should still render something instead of
    // throwing on ``Object.keys(null)``-style descents.
    const entry = makeListEntry();
    const { ctx, renderEntry, filterRenderable } = makeCtx({
      devices: [null, "weird", { id: "real" }],
    });
    renderNestedListField(entry, ["devices"], ctx);
    expect(filterRenderable).toHaveBeenCalledTimes(3);
    // Each of the 3 items still gets all 3 children rendered.
    expect(renderEntry).toHaveBeenCalledTimes(9);
  });

  it("respects filterRenderable filtering — children dropped per item", () => {
    const entry = makeListEntry();
    const { ctx, renderEntry, filterRenderable } = makeCtx({
      devices: [{ id: "a" }],
    });
    // Pretend the filter drops ``area_id`` for this item.
    filterRenderable.mockImplementation((entries) =>
      entries.filter((e) => e.key !== "area_id")
    );
    renderNestedListField(entry, ["devices"], ctx);
    expect(renderEntry).toHaveBeenCalledTimes(2);
    const keys = renderEntry.mock.calls.map((c) => (c[0] as ConfigEntry).key);
    expect(keys).not.toContain("area_id");
  });

  it("renders a YAML-only notice and disables Add/Remove for YamlRawValue", () => {
    // The parser preserves a list block byte-for-byte as
    // ``YamlRawValue`` when the items don't fit the flat-mapping
    // contract (dotted keys, block scalars, nested mappings).
    // The renderer must NOT coerce that to ``[]`` and offer Add /
    // Remove — the next save would clobber the user's preserved
    // YAML. Surface a notice instead, no Add/Remove, no children.
    const entry = makeListEntry();
    const { ctx, renderEntry } = makeCtx({
      devices: new YamlRawValue([
        "    - logger.log: hello",
        "      switch.turn_on: relay_id",
      ]),
    });
    const tpl = renderNestedListField(entry, ["devices"], ctx);
    // No per-item children rendered.
    expect(renderEntry).not.toHaveBeenCalled();
    // The YAML-only translation key is in the template.
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(json).toContain("device.multi_value_yaml_only");
    // No Add / Remove translation keys — those buttons aren't rendered.
    expect(json).not.toContain("device.multi_value_add");
    expect(json).not.toContain("device.multi_value_remove");
  });

  it("renders a load-normalized maybe_simple_value scalar as a populated row (#2397)", () => {
    // The end-to-end shape for ``voice_assistant: {microphone: mic_id}``:
    // normalizeMaybeValues expands the scalar at section load, and the
    // renderer sees the canonical one-item list — not the empty hint.
    const entry = makeConfigEntry({
      key: "microphone",
      type: ConfigEntryType.NESTED,
      multi_value: true,
      maybe_key: "microphone",
      config_entries: [
        makeConfigEntry({ key: "microphone", type: ConfigEntryType.ID }),
        makeConfigEntry({ key: "gain_factor", type: ConfigEntryType.INTEGER }),
      ],
    });
    const values = normalizeMaybeValues({ microphone: "onju_microphone" }, [entry]);
    const { ctx, renderEntry } = makeCtx(values);
    const tpl = renderNestedListField(entry, ["microphone"], ctx);
    const paths = renderEntry.mock.calls.map((c) => c[1] as string[]);
    expect(paths).toContainEqual(["microphone", "0", "microphone"]);
    expect(ctx.getAt(["microphone", "0", "microphone"])).toBe("onju_microphone");
    const json = JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));
    expect(json).not.toContain("device.multi_value_empty");
  });
});
