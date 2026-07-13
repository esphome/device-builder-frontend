// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  overflowingDescriptionIds,
  sameIdSet,
} from "../../../../src/components/device/component-catalog/description-overflow.js";

function makeParagraph(id: string | null, overflow: boolean): HTMLElement {
  const p = document.createElement("p");
  if (id !== null) p.dataset.componentId = id;
  Object.defineProperty(p, "scrollHeight", { value: overflow ? 40 : 20 });
  Object.defineProperty(p, "clientHeight", { value: 20 });
  return p;
}

describe("overflowingDescriptionIds", () => {
  it("collects only the ids whose clamped text overflows", () => {
    const ids = overflowingDescriptionIds([
      makeParagraph("sensor.dht", true),
      makeParagraph("async_tcp", false),
      makeParagraph("debug", true),
    ]);
    expect(ids).toEqual(new Set(["sensor.dht", "debug"]));
  });

  it("skips a paragraph without a component id", () => {
    expect(overflowingDescriptionIds([makeParagraph(null, true)])).toEqual(new Set());
  });

  it("treats equal heights as fitting", () => {
    // happy-dom and an exactly-two-line description both land here; an
    // expand button that reveals nothing must not appear.
    expect(overflowingDescriptionIds([makeParagraph("spi", false)])).toEqual(new Set());
  });

  it("honors an injected overflow predicate", () => {
    const ids = overflowingDescriptionIds([makeParagraph("spi", false)], () => true);
    expect(ids).toEqual(new Set(["spi"]));
  });
});

describe("sameIdSet", () => {
  it("matches sets regardless of insertion order", () => {
    expect(sameIdSet(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
  });

  it("rejects a size mismatch and a same-size membership mismatch", () => {
    expect(sameIdSet(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    expect(sameIdSet(new Set(["a", "c"]), new Set(["a", "b"]))).toBe(false);
  });
});
