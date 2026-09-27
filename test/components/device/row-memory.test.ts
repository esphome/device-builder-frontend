import { describe, expect, it, vi } from "vitest";
import { fieldKeyAttr } from "../../../src/components/device/config-entry-renderers-shared.js";
import { rowMemoryCtx } from "../../../src/components/device/config-entry-renderers/row-memory-ctx.js";
import {
  fieldKeyRowRekeyer,
  rekeyStore,
  rowForgotten,
  rowRekeyer,
  rowRemoved,
} from "../../../src/components/device/config-entry-renderers/row-memory.js";
import type { ConstraintClusterController } from "../../../src/components/device/constraint-cluster-controller.js";

const removed = (index: number) => rowRekeyer(["filters"], rowRemoved(index));

describe("rowRekeyer", () => {
  it.each([
    ["the removed row's key", "filters.1.multiply", null],
    ["a deeper key of the removed row", "filters.1.clamp.min_value", null],
    ["a row above", "filters.0.multiply", "filters.0.multiply"],
    ["a row below", "filters.2.multiply", "filters.1.multiply"],
    ["a row below, deeper", "filters.3.clamp.min_value", "filters.2.clamp.min_value"],
    ["a row of two digits", "filters.10.multiply", "filters.9.multiply"],
    ["a suffixed key", "filters.2.pin:pin-wiring", "filters.1.pin:pin-wiring"],
    ["a row key with a suffix", "filters.2:pin-advanced", "filters.1:pin-advanced"],
    ["the list itself", "filters", "filters"],
    ["another list", "effects.2.speed", "effects.2.speed"],
    ["a list whose name starts the same", "filters_extra.2.x", "filters_extra.2.x"],
    ["a key of the list that is no row", "filters.mode", "filters.mode"],
  ])("handles %s", (_name, key, expected) => {
    expect(removed(1)(key)).toBe(expected);
  });

  it("renumbers the outer list only, for a list inside a row", () => {
    expect(removed(0)("filters.1.steps.3.value")).toBe("filters.0.steps.3.value");
  });

  it("renumbers a list inside a row by its own path", () => {
    const rekey = rowRekeyer(["filters", "1", "steps"], rowRemoved(0));
    expect(rekey("filters.1.steps.1.value")).toBe("filters.1.steps.0.value");
    expect(rekey("filters.2.steps.1.value")).toBe("filters.2.steps.1.value");
  });
});

describe("a move of more than one index", () => {
  // Rows 0 and 2 can be edited, 1 cannot: removing row 0 brings row 2 to 0.
  const move = (row: number) => (row === 0 ? null : row === 2 ? 0 : row);

  it("sends a dotted key where its row goes", () => {
    const rekey = rowRekeyer(["filters"], move);
    expect(rekey("filters.0.multiply")).toBeNull();
    expect(rekey("filters.2.multiply")).toBe("filters.0.multiply");
    expect(rekey("filters.1.x")).toBe("filters.1.x");
  });

  it("sends a field key where its row goes", () => {
    const rekey = fieldKeyRowRekeyer(["filters"], move);
    expect(rekey(fieldKeyAttr(["filters", "2", "x"]))).toBe(
      fieldKeyAttr(["filters", "0", "x"])
    );
  });

  it("keeps both rows when two swap places in one store", () => {
    const store = new Map([
      ["l.0.x", "a"],
      ["l.1.x", "b"],
    ]);
    rekeyStore(
      store,
      rowRekeyer(["l"], (row) => 1 - row)
    );
    expect(Object.fromEntries(store)).toEqual({ "l.0.x": "b", "l.1.x": "a" });
  });
});

describe("fieldKeyRowRekeyer", () => {
  const key = (...path: string[]) => fieldKeyAttr(path);
  const rekey = fieldKeyRowRekeyer(["filters"], rowRemoved(1));

  it.each([
    ["the removed row's key", key("filters", "1", "x"), null],
    ["a row above", key("filters", "0", "x"), key("filters", "0", "x")],
    ["a row below", key("filters", "2", "x"), key("filters", "1", "x")],
    ["another list", key("effects", "2", "x"), key("effects", "2", "x")],
    ["the list itself", key("filters"), key("filters")],
  ])("handles %s", (_name, from, expected) => {
    expect(rekey(from)).toBe(expected);
  });

  it("keeps a map key that holds a dot apart from a row", () => {
    // ``logs["i2c.2"]`` reads like row 2 of ``logs.i2c`` in a dotted key.
    const dotted = fieldKeyRowRekeyer(["logs", "i2c"], rowRemoved(0));
    expect(dotted(key("logs", "i2c.2"))).toBe(key("logs", "i2c.2"));
    expect(dotted(key("logs", "i2c", "2"))).toBe(key("logs", "i2c", "1"));
  });
});

describe("rekeyStore", () => {
  it("moves a map's values to their new keys", () => {
    const store = new Map([
      ["filters.0.x", "a"],
      ["filters.1.x", "b"],
      ["filters.2.x", "c"],
      ["name", "n"],
    ]);
    rekeyStore(store, removed(0));
    expect([...store]).toEqual([
      ["filters.0.x", "b"],
      ["filters.1.x", "c"],
      ["name", "n"],
    ]);
  });

  it("renumbers a set in place", () => {
    const store = new Set(["filters.1.group", "filters.2.group"]);
    rekeyStore(store, removed(1));
    expect([...store]).toEqual(["filters.1.group"]);
  });
});

describe("rowMemoryCtx", () => {
  function setup() {
    const store = new Map([
      ["filters.0.x", "a"],
      ["filters.1.x", "b"],
      ["filters.2.x", "c"],
    ]);
    const clusters = { rekeyChoices: vi.fn() };
    const ctx = rowMemoryCtx(
      {},
      clusters as unknown as ConstraintClusterController,
      new Set(),
      [store]
    );
    return { store, clusters, ctx };
  }

  it("drops a removed row and moves the rows below it up", () => {
    const { store, clusters, ctx } = setup();
    ctx.rowsMoved(["filters"], rowRemoved(1));
    expect([...store]).toEqual([
      ["filters.0.x", "a"],
      ["filters.1.x", "c"],
    ]);
    expect(clusters.rekeyChoices).toHaveBeenCalledTimes(1);
  });

  it("forgets a row whose kind changed and leaves the others where they are", () => {
    const { store, ctx } = setup();
    ctx.rowsMoved(["filters"], rowForgotten(1));
    expect([...store]).toEqual([
      ["filters.0.x", "a"],
      ["filters.2.x", "c"],
    ]);
  });
});
