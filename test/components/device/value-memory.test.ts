import type { ReactiveControllerHost } from "lit";
import { describe, expect, it, vi } from "vitest";

import { ValueMemory } from "../../../src/components/device/config-entry-renderers/value-memory.js";

function setup() {
  const requestUpdate = vi.fn();
  const memory = new ValueMemory({ requestUpdate } as unknown as ReactiveControllerHost);
  return { memory, requestUpdate, ctx: memory.ctx };
}

describe("ValueMemory", () => {
  it("asks for a re-render on a picked unit, not on text being typed", () => {
    const { ctx, requestUpdate } = setup();
    ctx.setEditingMagnitude(["offset"], "1.");
    expect(requestUpdate).not.toHaveBeenCalled();
    ctx.setPendingUnit(["throttle"], "min");
    expect(requestUpdate).toHaveBeenCalledTimes(1);
  });

  it("forgets both on clear", () => {
    const { memory, ctx } = setup();
    ctx.setPendingUnit(["a"], "s");
    ctx.setEditingMagnitude(["b"], "-");
    memory.clear();
    expect(ctx.getPendingUnit(["a"])).toBeUndefined();
    expect(ctx.getEditingMagnitude(["b"])).toBeUndefined();
  });

  it("hands out the maps it keeps, for the rows of a list to be renumbered", () => {
    const { memory, ctx } = setup();
    ctx.setPendingUnit(["filters", "1", "throttle"], "min");
    ctx.setEditingMagnitude(["filters", "1", "offset"], "1.");
    expect(memory.stores.map((store) => [...store.keys()])).toEqual([
      ["filters.1.throttle"],
      ["filters.1.offset"],
    ]);
  });
});
