import { describe, expect, it, vi } from "vitest";
import { rowMemoryCtx } from "../../../src/components/device/config-entry-renderers/row-memory-ctx.js";
import {
  rekeyStore,
  rowRekeyer,
} from "../../../src/components/device/config-entry-renderers/row-memory.js";
import type { ConstraintClusterController } from "../../../src/components/device/constraint-cluster-controller.js";

const removed = (index: number) => rowRekeyer(["filters"], index);

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
    const rekey = rowRekeyer(["filters", "1", "steps"], 0);
    expect(rekey("filters.1.steps.1.value")).toBe("filters.1.steps.0.value");
    expect(rekey("filters.2.steps.1.value")).toBe("filters.2.steps.1.value");
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
    const ctx = rowMemoryCtx({}, clusters as unknown as ConstraintClusterController, [
      store,
    ]);
    return { store, clusters, ctx };
  }

  it("drops a removed row and moves the rows below it up", () => {
    const { store, clusters, ctx } = setup();
    ctx.rowRemoved(["filters"], 1);
    expect([...store]).toEqual([
      ["filters.0.x", "a"],
      ["filters.1.x", "c"],
    ]);
    expect(clusters.rekeyChoices).toHaveBeenCalledTimes(1);
  });

  it("forgets a row whose kind changed and leaves the others where they are", () => {
    const { store, ctx } = setup();
    ctx.rowKindChanged(["filters"], 1);
    expect([...store]).toEqual([
      ["filters.0.x", "a"],
      ["filters.2.x", "c"],
    ]);
  });
});
