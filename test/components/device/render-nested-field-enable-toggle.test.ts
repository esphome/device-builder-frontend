/**
 * Tests for the optional-entity enable toggle.
 *
 * Optional entity sub-readings (a debug component's per-metric
 * sensors, a DHT's temperature/humidity) only land in YAML once
 * their group holds a value, so an untouched one is silently "off".
 * ``renderNestedField`` gives those a ``wa-switch``; ``onEnableToggle``
 * is the change handler: on restores the stashed config (or seeds the
 * name) and expands, off stashes then clears the group so the block
 * leaves the YAML. Switch state derives from the current values
 * (loaded from YAML), so it round-trips.
 *
 * The render smoke tests inspect the returned ``TemplateResult``; the
 * behaviour tests drive ``onEnableToggle`` directly so they don't
 * depend on the order Lit serialises template bindings.
 */
import { describe, expect, it, vi } from "vitest";
import { ConfigEntryType, type ConfigEntry } from "../../../src/api/types.js";
import { renderNestedField } from "../../../src/components/device/config-entry-renderers.js";
import { onEnableToggle } from "../../../src/components/device/config-entry-renderers/nested.js";
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
  read: (path: string[]) => unknown;
}

// A ctx whose ``emitChange`` mutates a live values object (as the
// form's reducer would) so a follow-up ``getAt`` sees the change —
// needed for the off/on round-trip. ``stashOwner`` is stable per ctx
// so the disable-time stash survives into the re-enable call.
function makeCtx(initial: Record<string, unknown>): CtxStub {
  let values = initial;
  const emitChange = vi.fn((path: string[], value: unknown) => {
    values = setIn(values, path, value);
  });
  const toggleNested = vi.fn();
  const ctx: RenderCtx = {
    localize: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
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
  return { ctx, emitChange, toggleNested, read: (path) => getIn(values, path) };
}

const json = (tpl: unknown): string =>
  JSON.stringify(tpl, (k, v) => (k === "_$litType$" ? 0 : v));

describe("renderNestedField enable switch", () => {
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
});

describe("onEnableToggle", () => {
  it("enabling with no stash seeds the name with the entity label and expands", () => {
    const { ctx, emitChange, toggleNested } = makeCtx({});
    onEnableToggle(["min_free"], "min_free", false, true, "Min Free", ctx);
    expect(emitChange).toHaveBeenCalledWith(["min_free", "name"], "Min Free");
    expect(toggleNested).toHaveBeenCalledWith("min_free");
  });

  it("does not re-expand an already-open group on enable", () => {
    const { ctx, toggleNested } = makeCtx({});
    onEnableToggle(["min_free"], "min_free", true, true, "Min Free", ctx);
    expect(toggleNested).not.toHaveBeenCalled();
  });

  it("disabling clears the whole group and collapses it", () => {
    const { ctx, emitChange, toggleNested } = makeCtx({ min_free: { name: "Min Free" } });
    onEnableToggle(["min_free"], "min_free", true, false, "Min Free", ctx);
    expect(emitChange).toHaveBeenCalledWith(["min_free"], undefined);
    expect(toggleNested).toHaveBeenCalledWith("min_free");
  });

  it("restores the stashed config on off/on so no work is lost", () => {
    const configured = { name: "Custom", unit_of_measurement: "%", accuracy_decimals: 2 };
    const { ctx, emitChange, read } = makeCtx({ min_free: { ...configured } });

    onEnableToggle(["min_free"], "min_free", true, false, "Min Free", ctx);
    expect(read(["min_free"])).toBeUndefined();

    onEnableToggle(["min_free"], "min_free", false, true, "Min Free", ctx);
    expect(emitChange).toHaveBeenLastCalledWith(["min_free"], configured);
  });
});
