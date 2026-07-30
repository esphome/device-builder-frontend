/**
 * Tests for the optional-entity enable toggle.
 *
 * Optional entity sub-readings (a debug component's per-metric
 * sensors, a DHT's temperature/humidity) only land in YAML once
 * their group holds a value, so an untouched one is silently "off".
 * ``renderNestedField`` gives those a ``wa-switch``; ``onEnableToggle``
 * is the change handler: on restores the stashed config (or seeds
 * whichever identity field the schema offers) and expands, off stashes
 * then clears the group so the block leaves the YAML. Switch state
 * derives from the current values (loaded from YAML), so it round-trips.
 */
import { describe, expect, it, vi } from "vitest";
import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import { renderNestedField } from "../../../src/components/device/config-entry-renderers.js";
import { onEnableToggle } from "../../../src/components/device/config-entry-renderers/nested.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { getIn, setIn } from "../../../src/util/nested-values.js";
import { findElementBindings, makeRenderCtx } from "./_renderer-fixtures.js";

function makeSensorEntry(overrides: Partial<ConfigEntry> = {}): ConfigEntry {
  return makeConfigEntry({
    key: "min_free",
    type: ConfigEntryType.NESTED,
    platform_type: "sensor",
    config_entries: [makeConfigEntry({ key: "name", type: ConfigEntryType.STRING })],
    ...overrides,
  });
}

// A light's initial_state: no name, no declaring id — nothing to seed.
function makeInitialStateEntry(): ConfigEntry {
  return makeConfigEntry({
    key: "initial_state",
    type: ConfigEntryType.NESTED,
    platform_type: "light",
    config_entries: [
      makeConfigEntry({ key: "brightness", type: ConfigEntryType.FLOAT }),
      makeConfigEntry({
        key: "power_supply",
        type: ConfigEntryType.ID,
        references_component: "power_supply",
      }),
    ],
  });
}

const switchesOf = (tpl: unknown) => findElementBindings(tpl, "wa-switch");

describe("renderNestedField enable switch", () => {
  it("renders the switch for an optional entity sub-reading", () => {
    const tpl = renderNestedField(makeSensorEntry(), ["min_free"], makeRenderCtx({}));
    expect(switchesOf(tpl)).toHaveLength(1);
  });

  it("omits the switch for a plain nested group (no platform_type)", () => {
    const entry = makeSensorEntry({ platform_type: null });
    expect(
      switchesOf(renderNestedField(entry, ["min_free"], makeRenderCtx({})))
    ).toHaveLength(0);
  });

  it("omits the switch for a required entity group", () => {
    const entry = makeSensorEntry({ required: true });
    expect(
      switchesOf(renderNestedField(entry, ["min_free"], makeRenderCtx({})))
    ).toHaveLength(0);
  });

  it("reflects the group's current value as the switch checked state", () => {
    const [sw] = switchesOf(
      renderNestedField(
        makeSensorEntry(),
        ["min_free"],
        makeRenderCtx({ min_free: { name: "x" } })
      )
    );
    expect(sw[".checked"]).toBe(true);
  });

  it("renders the switch disabled for a board-locked entry", () => {
    const [sw] = switchesOf(
      renderNestedField(
        makeSensorEntry({ locked: true }),
        ["min_free"],
        makeRenderCtx({})
      )
    );
    expect(sw["?disabled"]).toBe(true);
    expect(sw[".checked"]).toBe(false);
  });
});

describe("onEnableToggle", () => {
  it("enabling with no stash seeds the name with the entity label and expands", () => {
    const ctx = makeRenderCtx({});
    onEnableToggle({
      entry: makeSensorEntry(),
      path: ["min_free"],
      key: "min_free",
      isOpen: false,
      checked: true,
      label: "Min Free",
      ctx,
    });
    expect(ctx.emitChange).toHaveBeenCalledWith(["min_free", "name"], "Min Free");
    expect(ctx.toggleNested).toHaveBeenCalledWith("min_free");
  });

  it("does not re-expand an already-open group on enable", () => {
    const ctx = makeRenderCtx({});
    onEnableToggle({
      entry: makeSensorEntry(),
      path: ["min_free"],
      key: "min_free",
      isOpen: true,
      checked: true,
      label: "Min Free",
      ctx,
    });
    expect(ctx.toggleNested).not.toHaveBeenCalled();
  });

  it("disabling clears the whole group and collapses it", () => {
    const ctx = makeRenderCtx({ min_free: { name: "Min Free" } });
    onEnableToggle({
      entry: makeSensorEntry(),
      path: ["min_free"],
      key: "min_free",
      isOpen: true,
      checked: false,
      label: "Min Free",
      ctx,
    });
    expect(ctx.emitChange).toHaveBeenCalledWith(["min_free"], undefined);
    expect(ctx.toggleNested).toHaveBeenCalledWith("min_free");
  });

  it("restores the stashed config on off/on so no work is lost", () => {
    const configured = { name: "Custom", unit_of_measurement: "%", accuracy_decimals: 2 };
    // emitChange mutates a live values object so the re-enable's getAt
    // sees the cleared group, as the form's reducer would. One ctx ⇒
    // one stashOwner, so the disable-time stash survives to re-enable.
    let values: Record<string, unknown> = { min_free: { ...configured } };
    const ctx = makeRenderCtx(
      {},
      {
        overrides: {
          emitChange: vi.fn((path: string[], value: unknown) => {
            values = setIn(values, path, value);
          }),
          getAt: (path: string[]) => getIn(values, path),
        },
      }
    );

    onEnableToggle({
      entry: makeSensorEntry(),
      path: ["min_free"],
      key: "min_free",
      isOpen: true,
      checked: false,
      label: "Min Free",
      ctx,
    });
    expect(getIn(values, ["min_free"])).toBeUndefined();

    onEnableToggle({
      entry: makeSensorEntry(),
      path: ["min_free"],
      key: "min_free",
      isOpen: false,
      checked: true,
      label: "Min Free",
      ctx,
    });
    expect(ctx.emitChange).toHaveBeenLastCalledWith(["min_free"], configured);
  });

  it("seeds a unique id when the group has no name field (#2459)", () => {
    // pipsolar's output sub-entities reject ``name:`` and require an id.
    const entry = makeConfigEntry({
      key: "battery_float_voltage",
      type: ConfigEntryType.NESTED,
      platform_type: "output",
      config_entries: [
        makeConfigEntry({ key: "id", type: ConfigEntryType.ID, required: true }),
        makeConfigEntry({ key: "inverted", type: ConfigEntryType.BOOLEAN }),
      ],
    });
    const ctx = makeRenderCtx(
      {},
      {
        overrides: {
          yaml: "output:\n  - platform: pipsolar\n    id: battery_float_voltage_1\n",
        },
      }
    );
    onEnableToggle({
      entry: entry,
      path: ["battery_float_voltage"],
      key: "battery_float_voltage",
      isOpen: false,
      checked: true,
      label: "Battery Float Voltage",
      ctx,
    });
    expect(ctx.emitChange).toHaveBeenCalledWith(
      ["battery_float_voltage", "id"],
      "battery_float_voltage_2"
    );
    expect(ctx.toggleNested).toHaveBeenCalledWith("battery_float_voltage");
  });

  it("seeds an optional declaring id — it is the group's only identity", () => {
    // opentherm's output sub-entities: no name, id present but not required.
    const entry = makeConfigEntry({
      key: "t_set",
      type: ConfigEntryType.NESTED,
      platform_type: "output",
      config_entries: [
        makeConfigEntry({ key: "id", type: ConfigEntryType.ID }),
        makeConfigEntry({
          key: "power_supply",
          type: ConfigEntryType.ID,
          references_component: "power_supply",
        }),
      ],
    });
    const ctx = makeRenderCtx({});
    onEnableToggle({
      entry: entry,
      path: ["t_set"],
      key: "t_set",
      isOpen: false,
      checked: true,
      label: "T Set",
      ctx,
    });
    expect(ctx.emitChange).toHaveBeenCalledWith(["t_set", "id"], "t_set_1");
  });

  it("writes no field when the schema offers neither a name nor an id", () => {
    // A light's ``initial_state`` has only colour/brightness fields; it
    // persists once the user sets one, and must not get an invalid ``name:``.
    const ctx = makeRenderCtx({});
    onEnableToggle({
      entry: makeInitialStateEntry(),
      path: ["initial_state"],
      key: "initial_state",
      isOpen: false,
      checked: true,
      label: "Initial",
      ctx,
    });
    expect(ctx.emitChange).toHaveBeenCalledWith(["initial_state"], undefined);
    expect(ctx.toggleNested).toHaveBeenCalledWith("initial_state");
  });

  it("re-emits an already-open identity-less group so the switch walks back", () => {
    // Nothing valid to write and no expand to trigger a re-render, so the
    // switch would otherwise read "on" over an absent group indefinitely.
    const ctx = makeRenderCtx({});
    onEnableToggle({
      entry: makeInitialStateEntry(),
      path: ["initial_state"],
      key: "initial_state",
      isOpen: true,
      checked: true,
      label: "Initial",
      ctx,
    });
    expect(ctx.emitChange).toHaveBeenCalledWith(["initial_state"], undefined);
    expect(ctx.toggleNested).not.toHaveBeenCalled();
  });

  it("prefers the name over a declaring id when the schema has both", () => {
    const entry = makeSensorEntry({
      config_entries: [
        makeConfigEntry({ key: "name", type: ConfigEntryType.STRING }),
        makeConfigEntry({ key: "id", type: ConfigEntryType.ID }),
      ],
    });
    const ctx = makeRenderCtx({});
    onEnableToggle({
      entry,
      path: ["min_free"],
      key: "min_free",
      isOpen: false,
      checked: true,
      label: "Min Free",
      ctx,
    });
    expect(ctx.emitChange).toHaveBeenCalledWith(["min_free", "name"], "Min Free");
    expect(ctx.emitChange).not.toHaveBeenCalledWith(["min_free", "id"], "min_free_1");
  });
});
