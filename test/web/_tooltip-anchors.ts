import { expect } from "vitest";

/**
 * Assert every ``wa-tooltip[for]`` in the element's shadow root resolves to
 * a real id, the same way ``wa-tooltip`` itself anchors
 * (``getRootNode().getElementById``). With the native ``title`` gone, a
 * typo'd or renamed anchor id would otherwise degrade silently.
 */
export function expectTooltipsAnchored(el: HTMLElement, count: number): void {
  const tips = [...el.shadowRoot!.querySelectorAll("wa-tooltip[for]")];
  expect(tips.length).toBe(count);
  for (const tip of tips) {
    const id = tip.getAttribute("for")!;
    expect(el.shadowRoot!.getElementById(id), id).not.toBeNull();
  }
}
