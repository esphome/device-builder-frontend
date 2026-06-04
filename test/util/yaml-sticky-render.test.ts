import { describe, expect, it } from "vitest";
import {
  stickyNumPaddingRight,
  type GutterMetrics,
} from "../../src/util/yaml-sticky-render.js";

/**
 * The pinned line-number span spans the full ``.cm-gutters`` width so the
 * sticky content stays aligned with the editor body. basicSetup also mounts
 * a fold gutter to the right of the line numbers, so right-aligning the glyph
 * against the full width drops it past the real gutter column. The right
 * inset pushes it back: fold-gutter width (gutters − lineNumbers) plus the
 * gutter cell's measured right padding, landing the glyph on the line-number
 * column's edge.
 *
 * jsdom has no layout engine (``offsetWidth`` is 0), so the pixel math is
 * only exercisable through this pure helper; the padding is measured live in
 * the plugin, so the helper takes it as input rather than hard-coding it.
 */
function metrics(over: Partial<GutterMetrics> = {}): GutterMetrics {
  return { width: 50, lineNumberWidth: 34, padLeft: 5, padRight: 3, ...over };
}

describe("stickyNumPaddingRight", () => {
  it("offsets the glyph past the fold gutter plus the cell's right padding", () => {
    // gutters 50, line numbers 34 → fold gutter 16, + 3 = 19.
    expect(stickyNumPaddingRight(metrics())).toBe(19);
  });

  it("uses the measured padding rather than a hard-coded constant", () => {
    // A theme with a 6px cell inset shifts the result to match.
    expect(stickyNumPaddingRight(metrics({ padRight: 6 }))).toBe(22);
  });

  it("collapses to the cell's right padding when there is no fold gutter", () => {
    expect(stickyNumPaddingRight(metrics({ width: 34 }))).toBe(3);
  });

  it("falls back to 8 before either width is measured", () => {
    expect(stickyNumPaddingRight(metrics({ width: 0, lineNumberWidth: 0 }))).toBe(8);
    expect(stickyNumPaddingRight(metrics({ lineNumberWidth: 0 }))).toBe(8);
    expect(stickyNumPaddingRight(metrics({ width: 0 }))).toBe(8);
  });
});
