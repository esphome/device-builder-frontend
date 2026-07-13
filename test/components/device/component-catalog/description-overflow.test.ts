// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { overflowingDescriptionIds } from "../../../../src/components/device/component-catalog/description-overflow.js";

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
      // Equal heights (an exactly-two-line description) count as fitting;
      // an expand button that reveals nothing must not appear.
      makeParagraph("async_tcp", false),
      makeParagraph("debug", true),
    ]);
    expect(ids).toEqual(new Set(["sensor.dht", "debug"]));
  });

  it("skips a paragraph without a component id", () => {
    expect(overflowingDescriptionIds([makeParagraph(null, true)])).toEqual(new Set());
  });
});
