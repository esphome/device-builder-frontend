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
    onEnableToggle(["min_free"], "min_free", false, true, "Min Free", ctx);
    expect(ctx.emitChange).toHaveBeenCalledWith(["min_free", "name"], "Min Free");
    expect(ctx.toggleNested).toHaveBeenCalledWith("min_free");
  });

  it("does not re-expand an already-open group on enable", () => {
    const ctx = makeRenderCtx({});
    onEnableToggle(["min_free"], "min_free", true, true, "Min Free", ctx);
    expect(ctx.toggleNested).not.toHaveBeenCalled();
  });

  it("disabling clears the whole group and collapses it", () => {
    const ctx = makeRenderCtx({ min_free: { name: "Min Free" } });
    onEnableToggle(["min_free"], "min_free", true, false, "Min Free", ctx);
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

    onEnableToggle(["min_free"], "min_free", true, false, "Min Free", ctx);
    expect(getIn(values, ["min_free"])).toBeUndefined();

    onEnableToggle(["min_free"], "min_free", false, true, "Min Free", ctx);
    expect(ctx.emitChange).toHaveBeenLastCalledWith(["min_free"], configured);
  });
});
