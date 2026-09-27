import { describe, expect, it, vi } from "vitest";
import { ValueMemory } from "../../../src/components/device/config-entry-renderers/value-memory.js";

function setup() {
  const memory = new ValueMemory();
  const requestUpdate = vi.fn();
  return { memory, requestUpdate, ctx: memory.ctx(requestUpdate) };
}

describe("ValueMemory", () => {
  it("keeps a picked unit by path and asks for a re-render", () => {
    const { ctx, requestUpdate } = setup();
    ctx.setPendingUnit(["filters", "0", "throttle"], "min");
    expect(ctx.getPendingUnit(["filters", "0", "throttle"])).toBe("min");
    expect(ctx.getPendingUnit(["filters", "1", "throttle"])).toBeUndefined();
    expect(requestUpdate).toHaveBeenCalledTimes(1);
  });

  it("keeps the text being typed without a re-render, until it is cleared", () => {
    const { ctx, requestUpdate } = setup();
    ctx.setEditingMagnitude(["offset"], "1.");
    expect(ctx.getEditingMagnitude(["offset"])).toBe("1.");
    expect(requestUpdate).not.toHaveBeenCalled();
    ctx.clearEditingMagnitude(["offset"]);
    expect(ctx.getEditingMagnitude(["offset"])).toBeUndefined();
  });

  it("forgets both on clear", () => {
    const { memory, ctx } = setup();
    ctx.setPendingUnit(["a"], "s");
    ctx.setEditingMagnitude(["b"], "-");
    memory.clear();
    expect(ctx.getPendingUnit(["a"])).toBeUndefined();
    expect(ctx.getEditingMagnitude(["b"])).toBeUndefined();
  });
});
