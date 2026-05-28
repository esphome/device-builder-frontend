/**
 * Tests for the optional-entity enable toggle in ``renderNestedField``.
 *
 * Optional entity sub-readings (a debug component's per-metric
 * sensors, a DHT's temperature/humidity) only land in YAML once
 * their group holds a value, so an untouched one is silently "off".
 * The renderer gives those a ``wa-switch``: on seeds the name +
 * expands, off clears the group. Switch state is derived from the
 * current values (loaded from YAML), so it round-trips.
 *
 * Runs in vitest's default ``node`` environment — no DOM — so we
 * inspect the returned ``TemplateResult`` and invoke the collected
 * event handlers directly rather than mounting a shadow root.
 */
import { describe, expect, it, vi } from "vitest";
import { ConfigEntryType, type ConfigEntry } from "../../../src/api/types.js";
import { renderNestedField } from "../../../src/components/device/config-entry-renderers.js";
import type { RenderCtx } from "../../../src/components/device/config-entry-renderers-shared.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { getIn, setIn } from "../../../src/util/nested-values.js";

function makeSensorEntry(overrides: Partial<ConfigEntry> = {}): ConfigEntry {
  return makeConfigEntry({
    key: "min_free",
    type: ConfigEntryType.NESTED,
    platform_type: "sensor",
    config_entries: [makeConfigEntry({ key: "name", type: ConfigEntryType.STRING })],
    ...overrides,
  });
}

interface CtxStub {
  ctx: RenderCtx;
  emitChange: ReturnType<typeof vi.fn>;
  toggleNested: ReturnType<typeof vi.fn>;
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

function makeCtx(values: Record<string, unknown>, openKeys: string[] = []): CtxStub {
  const emitChange = vi.fn();
  const toggleNested = vi.fn();
  const ctx: RenderCtx = {
    localize: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
    disabled: false,
    yaml: "",
    fromLine: undefined,
    sectionKey: "",
    board: null,
    requiredOnly: false,
    nestedOpenSections: new Set(openKeys),
    getAt: (path: string[]) => getIn(values, path),
    errorAt: () => null,
    emitChange,
    toggleNested,
    requestAddComponent: () => {},
    scopeValues: () => ({}),
    filterRenderable: (entries: ConfigEntry[]) => entries,
    renderEntry: () => "<rendered>",
    getPendingUnit: () => undefined,
    setPendingUnit: () => {},
    getEditingMagnitude: () => undefined,
    setEditingMagnitude: () => {},
    clearEditingMagnitude: () => {},
    stashOwner: {},
  };
  return { ctx, emitChange, toggleNested };
}

const json = (tpl: unknown): string =>
  JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));

// Handler render order: switch @click (stopPropagation), switch
// @change (the toggle), button @click (expand/collapse).
const SWITCH_CHANGE_IDX = 1;

describe("renderNestedField enable toggle", () => {
  it("renders the switch for an optional entity sub-reading", () => {
    const tpl = renderNestedField(makeSensorEntry(), ["min_free"], makeCtx({}).ctx);
    expect(json(tpl)).toContain("device.enable_entity");
  });

  it("omits the switch for a plain nested group (no platform_type)", () => {
    const entry = makeSensorEntry({ platform_type: null });
    const tpl = renderNestedField(entry, ["min_free"], makeCtx({}).ctx);
    expect(json(tpl)).not.toContain("device.enable_entity");
  });

  it("omits the switch for a required entity group", () => {
    const entry = makeSensorEntry({ required: true });
    const tpl = renderNestedField(entry, ["min_free"], makeCtx({}).ctx);
    expect(json(tpl)).not.toContain("device.enable_entity");
  });

  it("enabling seeds the name with the entity label and expands the group", () => {
    const { ctx, emitChange, toggleNested } = makeCtx({});
    const tpl = renderNestedField(makeSensorEntry(), ["min_free"], ctx);
    const handlers = collectHandlers(tpl.values);
    handlers[SWITCH_CHANGE_IDX]({ target: { checked: true } });
    expect(emitChange).toHaveBeenCalledWith(["min_free", "name"], "Min Free");
    expect(toggleNested).toHaveBeenCalledWith("min_free");
  });

  it("disabling clears the whole group and collapses it", () => {
    const { ctx, emitChange, toggleNested } = makeCtx(
      { min_free: { name: "Min Free" } },
      ["min_free"]
    );
    const tpl = renderNestedField(makeSensorEntry(), ["min_free"], ctx);
    const handlers = collectHandlers(tpl.values);
    handlers[SWITCH_CHANGE_IDX]({ target: { checked: false } });
    expect(emitChange).toHaveBeenCalledWith(["min_free"], undefined);
    expect(toggleNested).toHaveBeenCalledWith("min_free");
  });

  it("does not re-expand an already-open group on enable", () => {
    const { ctx, toggleNested } = makeCtx({}, ["min_free"]);
    const tpl = renderNestedField(makeSensorEntry(), ["min_free"], ctx);
    const handlers = collectHandlers(tpl.values);
    handlers[SWITCH_CHANGE_IDX]({ target: { checked: true } });
    expect(toggleNested).not.toHaveBeenCalled();
  });

  it("restores the stashed config on off/on so no work is lost", () => {
    // One ctx (one stashOwner) reused across both renders; emitChange
    // applies to a live values object so the second render sees the
    // cleared group, exactly as the form's reducer would.
    const configured = {
      name: "Custom",
      unit_of_measurement: "%",
      accuracy_decimals: 2,
    };
    let values: Record<string, unknown> = { min_free: { ...configured } };
    const emitChange = vi.fn((path: string[], value: unknown) => {
      values = setIn(values, path, value);
    });
    const ctx: RenderCtx = {
      ...makeCtx({}, ["min_free"]).ctx,
      getAt: (path: string[]) => getIn(values, path),
      emitChange,
    };

    // Toggle OFF: clears the YAML block but stashes the config.
    const offHandlers = collectHandlers(
      renderNestedField(makeSensorEntry(), ["min_free"], ctx).values
    );
    offHandlers[SWITCH_CHANGE_IDX]({ target: { checked: false } });
    expect(getIn(values, ["min_free"])).toBeUndefined();

    // Toggle ON again: the full configuration comes back, not just the name.
    const onHandlers = collectHandlers(
      renderNestedField(makeSensorEntry(), ["min_free"], ctx).values
    );
    onHandlers[SWITCH_CHANGE_IDX]({ target: { checked: true } });
    expect(emitChange).toHaveBeenLastCalledWith(["min_free"], configured);
  });
});
