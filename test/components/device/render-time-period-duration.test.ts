/**
 * @vitest-environment happy-dom
 *
 * The time-period widget offers only the units the entry's precision
 * allows, and reads a whole-body duration in its mapping form.
 */
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/option/option.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/select/select.js", () => ({}));

import {
  type ConfigEntry,
  ConfigEntryType,
} from "../../../src/api/types/config-entries.js";
import { renderTimePeriodField } from "../../../src/components/device/config-entry-renderers/primitives.js";
import { makeScalarValueEntry } from "../../../src/components/device/config-entry-renderers/scalar-value-entry.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";
import { makeEmitCtx } from "./_renderer-fixtures.js";

const PATH = ["id"];

function field(overrides: Partial<ConfigEntry> = {}): ConfigEntry {
  return makeConfigEntry({
    key: "id",
    type: ConfigEntryType.TIME_PERIOD,
    label: "Value",
    ...overrides,
  });
}

function wholeBody(minUnit?: string): ConfigEntry {
  return makeScalarValueEntry(
    ConfigEntryType.TIME_PERIOD,
    { value_type: "time_period", duration_min_unit: minUnit },
    { key: "id", label: "Value" }
  );
}

/** The form's pending-unit store, shared across renders of one field. */
function pendingUnits() {
  const units = new Map<string, string>();
  return {
    getPendingUnit: (path: string[]) => units.get(path.join(".")),
    setPendingUnit: vi.fn((path: string[], unit: string) => {
      units.set(path.join("."), unit);
    }),
  };
}

function mount(entry: ConfigEntry, value: unknown, pending = pendingUnits()) {
  const { ctx, emitChange } = makeEmitCtx({ id: value }, pending);
  const host = document.createElement("div");
  render(renderTimePeriodField(entry, PATH, ctx), host);
  const options = [...host.querySelectorAll("wa-option")];
  return {
    host,
    emitChange,
    pending,
    pickUnit: (unit: string) => {
      const select = host.querySelector("wa-select") as HTMLElement & { value: string };
      select.value = unit;
      select.dispatchEvent(new Event("change"));
    },
    input: host.querySelector<HTMLInputElement>(".time-period-inputs input"),
    units: options.map((o) => o.getAttribute("value")),
    selected:
      options.find((o) => o.hasAttribute("selected"))?.getAttribute("value") ?? null,
    yamlOnly: host.textContent?.includes("device.value_yaml_only") ?? false,
  };
}

describe("renderTimePeriodField unit picker", () => {
  it("offers every unit when the entry names no precision", () => {
    expect(mount(field(), "5s").units).toEqual(["us", "ms", "s", "min", "h", "d"]);
  });

  it("hides microseconds on a millisecond-precision entry", () => {
    const { units, selected } = mount(field({ duration_min_unit: "ms" }), "5s");
    expect(units).toEqual(["ms", "s", "min", "h", "d"]);
    expect(selected).toBe("s");
  });

  it("keeps the unit a stored value already uses, so it still displays", () => {
    const { units, selected, input } = mount(field({ duration_min_unit: "ms" }), "4us");
    expect(units).toEqual(["us", "ms", "s", "min", "h", "d"]);
    expect(selected).toBe("us");
    expect(input!.value).toBe("4");
  });

  it("starts an empty field on the finest unit the entry accepts", () => {
    const { units, selected, input, emitChange } = mount(
      field({ duration_min_unit: "min" }),
      ""
    );
    expect(units).toEqual(["min", "h", "d"]);
    expect(selected).toBe("min");
    input!.value = "5";
    input!.dispatchEvent(new Event("input"));
    expect(emitChange).toHaveBeenCalledWith(PATH, "5min");
  });

  it("starts an empty field on its default's unit when the entry accepts it", () => {
    const entry = field({ duration_min_unit: "ms", default_value: "5min" });
    expect(mount(entry, undefined).selected).toBe("min");
  });

  it("clamps a default's unit that is finer than the entry accepts", () => {
    const entry = field({ duration_min_unit: "s", default_value: "500ms" });
    const { units, selected } = mount(entry, undefined);
    expect(units).toEqual(["s", "min", "h", "d"]);
    expect(selected).toBe("s");
  });

  it.each(["5", 5])("shows a bare %j with no unit picked", (stored) => {
    // ESPHome rejects a number with no unit, so it must not read as seconds.
    const { input, selected, units } = mount(field({ duration_min_unit: "ms" }), stored);
    expect(input!.value).toBe("5");
    expect(selected).toBeNull();
    expect(units).toEqual(["ms", "s", "min", "h", "d"]);
  });

  it("gives a bare number the unit the user picks", () => {
    const { pickUnit, emitChange } = mount(field({ duration_min_unit: "ms" }), "5");
    pickUnit("min");
    expect(emitChange).toHaveBeenCalledWith(PATH, "5min");
  });

  it("keeps a unit picked on an empty field for the number typed next", () => {
    const entry = field({ duration_min_unit: "ms" });
    const empty = mount(entry, "");
    empty.pickUnit("min");
    expect(empty.pending.setPendingUnit).toHaveBeenCalledWith(PATH, "min");
    expect(empty.emitChange).not.toHaveBeenCalled();

    const next = mount(entry, "", empty.pending);
    expect(next.selected).toBe("min");
    next.input!.value = "5";
    next.input!.dispatchEvent(new Event("input"));
    expect(next.emitChange).toHaveBeenCalledWith(PATH, "5min");
  });

  it("lets a stored unit win over a unit picked earlier", () => {
    const pending = pendingUnits();
    pending.setPendingUnit(PATH, "h");
    expect(mount(field(), "5s", pending).selected).toBe("s");
  });

  it("ignores a pending unit the entry does not accept", () => {
    const pending = pendingUnits();
    pending.setPendingUnit(PATH, "us");
    const { selected } = mount(field({ duration_min_unit: "ms" }), "", pending);
    expect(selected).toBe("s");
  });

  it("gives a bare number a valid unit once it is edited", () => {
    const { input, emitChange } = mount(field({ duration_min_unit: "min" }), "5");
    input!.value = "7";
    input!.dispatchEvent(new Event("input"));
    expect(emitChange).toHaveBeenCalledWith(PATH, "7min");
  });

  it("labels the unit picker for assistive tech", () => {
    const { host } = mount(field(), "5s");
    expect(host.querySelector("wa-select")!.getAttribute("aria-label")).toBe(
      "device.automation_action_delay_unit"
    );
  });
});

describe("renderTimePeriodField mapping form", () => {
  it("reads a single-unit mapping as value + unit on a whole-body duration", () => {
    const { input, selected, yamlOnly } = mount(wholeBody("ms"), { seconds: 2 });
    expect(yamlOnly).toBe(false);
    expect(input!.value).toBe("2");
    expect(selected).toBe("s");
  });

  it("reads a quoted amount the same way", () => {
    const { input, selected } = mount(wholeBody("ms"), { milliseconds: "250" });
    expect(input!.value).toBe("250");
    expect(selected).toBe("ms");
  });

  it("writes the scalar form when a mapping value is edited", () => {
    const { input, emitChange } = mount(wholeBody("ms"), { seconds: 2 });
    input!.value = "5";
    input!.dispatchEvent(new Event("input"));
    expect(emitChange).toHaveBeenCalledWith(PATH, "5s");
  });

  it("leaves a multi-unit mapping to the YAML editor", () => {
    const { input, yamlOnly, emitChange } = mount(wholeBody("ms"), {
      minutes: 1,
      seconds: 30,
    });
    expect(yamlOnly).toBe(true);
    expect(input).toBeNull();
    expect(emitChange).not.toHaveBeenCalled();
  });

  it("leaves a mapping with a non-unit key to the YAML editor", () => {
    expect(mount(wholeBody("ms"), { entity_state: "room_temp" }).yamlOnly).toBe(true);
  });

  it("keeps the YAML-only notice for a mapping on a regular field", () => {
    const { input, yamlOnly } = mount(field({ duration_min_unit: "ms" }), { seconds: 2 });
    expect(yamlOnly).toBe(true);
    expect(input).toBeNull();
  });
});
