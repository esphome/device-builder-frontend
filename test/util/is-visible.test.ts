// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { isVisible } from "../../src/util/is-visible.js";

function makeElement({
  connected = true,
  checkVisibility,
  offsetParent = null,
}: {
  connected?: boolean;
  checkVisibility?: () => boolean;
  offsetParent?: Element | null;
} = {}): HTMLElement {
  const el = document.createElement("div");
  if (connected) document.body.append(el);
  if (checkVisibility) el.checkVisibility = checkVisibility;
  else Object.defineProperty(el, "checkVisibility", { value: undefined });
  Object.defineProperty(el, "offsetParent", { value: offsetParent });
  return el;
}

describe("isVisible", () => {
  it("rejects a disconnected element", () => {
    expect(isVisible(makeElement({ connected: false }))).toBe(false);
  });

  it("trusts checkVisibility when the engine provides it", () => {
    expect(isVisible(makeElement({ checkVisibility: () => true }))).toBe(true);
    expect(
      isVisible(
        makeElement({ checkVisibility: () => false, offsetParent: document.body })
      )
    ).toBe(false);
  });

  it("falls back to offsetParent when checkVisibility is missing", () => {
    expect(isVisible(makeElement({ offsetParent: document.body }))).toBe(true);
    expect(isVisible(makeElement({ offsetParent: null }))).toBe(false);
  });
});
