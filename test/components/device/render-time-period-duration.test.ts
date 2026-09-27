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

function mount(entry: ConfigEntry, value: unknown) {
  const { ctx, emitChange } = makeEmitCtx({ id: value });
  const host = document.createElement("div");
  render(renderTimePeriodField(entry, PATH, ctx), host);
  const options = [...host.querySelectorAll("wa-option")];
  return {
    host,
    emitChange,
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

  it("offers seconds and coarser on a second-precision entry", () => {
    expect(mount(field({ duration_min_unit: "s" }), "").units).toEqual([
      "s",
      "min",
      "h",
      "d",
    ]);
  });

  it("offers every unit on a nanosecond-precision entry", () => {
    expect(mount(field({ duration_min_unit: "ns" }), "5s").units).toHaveLength(6);
  });

  it("keeps the unit a stored value already uses, so it still displays", () => {
    const { units, selected, input } = mount(field({ duration_min_unit: "ms" }), "4us");
    expect(units).toEqual(["us", "ms", "s", "min", "h", "d"]);
    expect(selected).toBe("us");
    expect(input!.value).toBe("4");
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
