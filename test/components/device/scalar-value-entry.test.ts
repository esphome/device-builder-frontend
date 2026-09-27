import { describe, expect, it } from "vitest";
import { makeAutomationAction } from "../../_make-automation-action.js";
import { ConfigEntryType } from "../../../src/api/types/config-entries.js";
import {
  makeScalarValueEntry,
  paramEntriesOf,
  scalarValueType,
} from "../../../src/components/device/config-entry-renderers/scalar-value-entry.js";
import { makeConfigEntry } from "../../../src/util/config-entry-defaults.js";

const DELAY = makeAutomationAction({
  id: "delay",
  name: "Delay",
  value_type: "time_period",
  templatable: true,
  duration_min_unit: "ms",
});

describe("scalarValueType", () => {
  it("maps a known value_type to its widget type", () => {
    expect(scalarValueType({ value_type: "time_period" })).toBe(
      ConfigEntryType.TIME_PERIOD
    );
    expect(scalarValueType({ value_type: "lambda" })).toBe(ConfigEntryType.LAMBDA);
  });

  it("is null without a value_type or for one this build doesn't know", () => {
    expect(scalarValueType(undefined)).toBeNull();
    expect(scalarValueType({})).toBeNull();
    expect(scalarValueType({ value_type: "toString" as never })).toBeNull();
  });
});

describe("makeScalarValueEntry", () => {
  it("carries precision and the mapping marker on a duration", () => {
    expect(makeScalarValueEntry(ConfigEntryType.TIME_PERIOD, DELAY)).toMatchObject({
      type: ConfigEntryType.TIME_PERIOD,
      templatable: true,
      duration_min_unit: "ms",
      accepts_duration_mapping: true,
    });
  });

  it("adds neither to a non-duration value", () => {
    const entry = makeScalarValueEntry(ConfigEntryType.FLOAT, {
      value_type: "float",
      templatable: true,
      duration_min_unit: "ms",
    });
    expect(entry).toMatchObject({ type: ConfigEntryType.FLOAT, templatable: true });
    expect(entry).not.toHaveProperty("duration_min_unit");
    expect(entry).not.toHaveProperty("accepts_duration_mapping");
  });
});

describe("paramEntriesOf", () => {
  it("returns the catalog fields of a field-based action", () => {
    const fields = [makeConfigEntry({ key: "format", label: "Format" })];
    const action = makeAutomationAction({ id: "logger.log", config_entries: fields });
    expect(paramEntriesOf(action, "Value")).toBe(fields);
  });

  it("returns the one value entry of a scalar-bodied action", () => {
    expect(paramEntriesOf(DELAY, "Value")).toEqual([
      expect.objectContaining({
        key: "id",
        label: "Value",
        required: true,
        type: ConfigEntryType.TIME_PERIOD,
        templatable: true,
        duration_min_unit: "ms",
        accepts_duration_mapping: true,
      }),
    ]);
  });

  it("renders the value entry before the action's body has hydrated", () => {
    const row = { ...DELAY, config_entries: undefined } as unknown as typeof DELAY;
    expect(paramEntriesOf(row, "Value")).toHaveLength(1);
  });

  it("keeps one array per action so the form mount sees a stable property", () => {
    expect(paramEntriesOf(DELAY, "Value")).toBe(paramEntriesOf(DELAY, "Value"));
  });

  it("rebuilds when the label changes with the locale", () => {
    const english = paramEntriesOf(DELAY, "Value");
    expect(paramEntriesOf(DELAY, "Waarde")[0].label).toBe("Waarde");
    expect(english[0].label).toBe("Value");
  });

  it("has nothing to render for an action with no fields and no value", () => {
    expect(
      paramEntriesOf(makeAutomationAction({ id: "ethernet.disable" }), "Value")
    ).toEqual([]);
  });
});
