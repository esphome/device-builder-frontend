/**
 * Unit tests for the pure registry-list helpers extracted from
 * ``registry-list.ts``. The element-level renderer test exercises these
 * through the DOM; this file pins the context-free behaviour directly,
 * with particular attention to ``spliceEditable``'s foreign-entry
 * preservation (the load-bearing invariant: a click in the visual
 * editor must never drop data the form doesn't understand).
 */
import { describe, expect, it } from "vitest";

import {
  asList,
  editableEntries,
  formatRegistryId,
  isEditableItem,
  itemId,
  REGISTRY_OPS,
  spliceEditable,
  VALUE_TYPE_TO_CONFIG_TYPE,
} from "../../../src/components/device/config-entry-renderers/registry-list-helpers.js";

describe("itemId", () => {
  it("returns the single key", () => {
    expect(itemId({ throttle: null })).toBe("throttle");
  });

  it("returns the empty sentinel for a zero-key (freshly-added) item", () => {
    expect(itemId({})).toBe("");
  });

  it("returns the empty sentinel for a malformed multi-key item", () => {
    expect(itemId({ a: 1, b: 2 })).toBe("");
  });
});

describe("isEditableItem", () => {
  it("accepts plain objects with zero or one key", () => {
    expect(isEditableItem({})).toBe(true);
    expect(isEditableItem({ delta: 0.5 })).toBe(true);
  });

  it("rejects multi-key objects as foreign", () => {
    expect(isEditableItem({ a: 1, b: 2 })).toBe(false);
  });

  it("rejects non-object and null entries", () => {
    expect(isEditableItem(null)).toBe(false);
    expect(isEditableItem("throttle")).toBe(false);
    expect(isEditableItem(5)).toBe(false);
    expect(isEditableItem([1, 2])).toBe(false);
  });
});

describe("formatRegistryId", () => {
  it("titlecases an underscored id", () => {
    expect(formatRegistryId("binary_sensor_map")).toBe("Binary Sensor Map");
  });

  it("titlecases a bare id", () => {
    expect(formatRegistryId("throttle")).toBe("Throttle");
  });

  it("returns empty for the unselected sentinel", () => {
    expect(formatRegistryId("")).toBe("");
  });
});

describe("asList", () => {
  it("passes arrays through", () => {
    const arr = [{ a: 1 }];
    expect(asList(arr)).toBe(arr);
  });

  it("coerces non-array shapes to an empty list", () => {
    expect(asList(undefined)).toEqual([]);
    expect(asList(null)).toEqual([]);
    expect(asList("raw")).toEqual([]);
    expect(asList({})).toEqual([]);
  });
});

describe("editableEntries", () => {
  it("collects editable items with their original positions, skipping foreign entries", () => {
    const list = [{ a: 1 }, [1, 2], { x: 1, y: 2 }, {}];
    expect(editableEntries(list)).toEqual({
      items: [{ a: 1 }, {}],
      positions: [0, 3],
    });
  });

  it("returns empty arrays for an all-foreign list", () => {
    expect(editableEntries(["foreign", { a: 1, b: 2 }])).toEqual({
      items: [],
      positions: [],
    });
  });
});

describe("spliceEditable", () => {
  it("replaces editable slots in place (edit)", () => {
    const list = [{ a: 1 }, { b: 2 }];
    expect(spliceEditable(list, [0, 1], [{ a: 9 }, { b: 2 }])).toEqual([
      { a: 9 },
      { b: 2 },
    ]);
  });

  it("removes a trailing editable slot while preserving foreign entries (remove)", () => {
    const list = [{ a: 1 }, "foreign", { b: 2 }];
    expect(spliceEditable(list, [0, 2], [{ a: 1 }])).toEqual([{ a: 1 }, "foreign"]);
  });

  it("inserts a new entry after the last editable slot, before trailing foreign entries (add)", () => {
    const list = [{ a: 1 }, "foreign"];
    expect(spliceEditable(list, [0], [{ a: 1 }, { c: 3 }])).toEqual([
      { a: 1 },
      { c: 3 },
      "foreign",
    ]);
  });

  it("appends to the end when there are no editable slots yet", () => {
    const list = ["foreign"];
    expect(spliceEditable(list, [], [{ c: 3 }])).toEqual(["foreign", { c: 3 }]);
  });

  it("does not mutate the input list", () => {
    const list = [{ a: 1 }];
    const copy = [...list];
    spliceEditable(list, [0], [{ a: 1 }, { b: 2 }]);
    expect(list).toEqual(copy);
  });
});

describe("registry tables", () => {
  it("maps every value_type to a config-entry type", () => {
    expect(Object.keys(VALUE_TYPE_TO_CONFIG_TYPE)).toEqual([
      "time_period",
      "float",
      "integer",
      "string",
      "lambda",
    ]);
  });

  it("scopes light_effects parentToken to the whole section key and dedups by type id", () => {
    const ops = REGISTRY_OPS.light_effects;
    expect(ops.parentToken("light.esp32_rmt_led_strip")).toBe(
      "light.esp32_rmt_led_strip"
    );
    expect(ops.dedupByTypeId).toBe(true);
  });

  it("scopes filter parentToken to the bare domain and allows repeated type ids", () => {
    const ops = REGISTRY_OPS.filter;
    expect(ops.parentToken("sensor.temperature")).toBe("sensor");
    expect(ops.dedupByTypeId).toBe(false);
  });
});
