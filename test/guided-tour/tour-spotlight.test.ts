import { describe, expect, it } from "vitest";
import { renderTourSpotlightBackdrop } from "../../src/components/guided-tour/tour-spotlight.js";
import type { TourFrame } from "../../src/components/guided-tour/tour-geometry.js";
import { findTemplatesByAnchor } from "../_lit-template-walker.js";

const FRAME: TourFrame = {
  hole: { x: 100, y: 80, w: 200, h: 120 },
  dim: {
    top: { x: 0, y: 0, w: 800, h: 80 },
    bottom: { x: 0, y: 200, w: 800, h: 400 },
    left: { x: 0, y: 80, w: 100, h: 120 },
    right: { x: 300, y: 80, w: 500, h: 120 },
  },
  bubble: { left: 316, top: 80, width: 300 },
  side: "right",
};

describe("renderTourSpotlightBackdrop", () => {
  it("renders four dim panels around the target cutout", () => {
    const result = renderTourSpotlightBackdrop(FRAME);

    expect(findTemplatesByAnchor(result, 'class="tour-dim"')).toHaveLength(4);
  });
});
