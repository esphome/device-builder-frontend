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
  const ids = tips.map((tip) => tip.getAttribute("for")!);
  // getElementById returns the first match, so tooltips sharing an anchor
  // id silently pile onto one button; require distinct anchors.
  expect(new Set(ids).size, "duplicate wa-tooltip anchors").toBe(ids.length);
  for (const id of ids) {
    expect(el.shadowRoot!.getElementById(id), id).not.toBeNull();
  }
}
