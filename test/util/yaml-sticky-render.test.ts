import { describe, expect, it } from "vitest";
import { stickyNumPaddingRight } from "../../src/util/yaml-sticky-render.js";

/**
 * The pinned line-number span spans the full ``.cm-gutters`` width so the
 * sticky content stays aligned with the editor body. basicSetup also mounts
 * a fold gutter to the right of the line numbers, so right-aligning the glyph
 * against the full width drops it past the real gutter column. The right
 * inset pushes it back: fold-gutter width (gutters − lineNumbers) plus CM's
 * own 3px cell inset, landing the glyph on the line-number column's edge.
 *
 * jsdom has no layout engine (``offsetWidth`` is 0), so the pixel math is
 * only exercisable through this pure helper.
 */
describe("stickyNumPaddingRight", () => {
  it("offsets the glyph past the fold gutter plus CM's 3px inset", () => {
    // gutters 50, line numbers 34 → fold gutter 16, + 3 = 19.
    expect(stickyNumPaddingRight(50, 34)).toBe(19);
  });

  it("collapses to CM's 3px inset when there is no fold gutter", () => {
    expect(stickyNumPaddingRight(34, 34)).toBe(3);
  });

  it("falls back to 8 before either width is measured", () => {
    expect(stickyNumPaddingRight(0, 0)).toBe(8);
    expect(stickyNumPaddingRight(50, 0)).toBe(8);
    expect(stickyNumPaddingRight(0, 34)).toBe(8);
  });
});
