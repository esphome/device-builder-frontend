import { describe, expect, it } from "vitest";
import {
  BUBBLE_GAP,
  BUBBLE_WIDTH,
  SPOTLIGHT_PADDING,
  clamp,
  computeHole,
  computeTourFrame,
  type Rect,
  type Viewport,
} from "../../src/components/guided-tour/tour-geometry.js";

const VP: Viewport = { w: 1280, h: 800 };
// A target comfortably inside the viewport so nothing clamps unexpectedly.
const TARGET: Rect = { x: 400, y: 300, w: 120, h: 40 };

describe("clamp", () => {
  it("bounds a value within the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it("biases to the low bound when hi < lo (tiny viewport)", () => {
    expect(clamp(50, 16, 4)).toBe(16);
  });
});

describe("computeHole", () => {
  it("pads the target rect on every side", () => {
    const hole = computeHole(TARGET);
    expect(hole).toEqual({
      x: TARGET.x - SPOTLIGHT_PADDING,
      y: TARGET.y - SPOTLIGHT_PADDING,
      w: TARGET.w + SPOTLIGHT_PADDING * 2,
      h: TARGET.h + SPOTLIGHT_PADDING * 2,
    });
  });
});

describe("computeTourFrame dim panels", () => {
  it("the four dim panels tile around the hole without covering it", () => {
    const { hole, dim } = computeTourFrame(TARGET, "right", VP);
    // Top + bottom span the full width; left + right fill the hole's band.
    expect(dim.top).toEqual({ x: 0, y: 0, w: VP.w, h: hole.y });
    expect(dim.bottom.y).toBe(hole.y + hole.h);
    expect(dim.bottom.h).toBe(VP.h - (hole.y + hole.h));
    expect(dim.left).toEqual({ x: 0, y: hole.y, w: hole.x, h: hole.h });
    expect(dim.right.x).toBe(hole.x + hole.w);
    expect(dim.right.w).toBe(VP.w - (hole.x + hole.w));
  });

  it("never produces negative panel sizes for an edge-hugging target", () => {
    const corner: Rect = { x: 0, y: 0, w: 30, h: 30 };
    const { dim } = computeTourFrame(corner, "bottom", VP);
    for (const panel of [dim.top, dim.bottom, dim.left, dim.right]) {
      expect(panel.w).toBeGreaterThanOrEqual(0);
      expect(panel.h).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("computeTourFrame ring", () => {
  it("matches the hole and caps the corner radius at half its height", () => {
    const { hole, ring } = computeTourFrame(TARGET, "right", VP);
    expect({ x: ring.x, y: ring.y, w: ring.w, h: ring.h }).toEqual(hole);
    expect(ring.radius).toBe(Math.min(hole.h / 2, 14));
  });
});

describe("computeTourFrame bubble placement", () => {
  it("places a right-side bubble just past the hole, top-anchored", () => {
    const { hole, bubble } = computeTourFrame(TARGET, "right", VP);
    expect(bubble.left).toBe(hole.x + hole.w + BUBBLE_GAP);
    expect(bubble.top).toBe(hole.y);
    expect(bubble.bottom).toBeUndefined();
    expect(bubble.width).toBe(BUBBLE_WIDTH);
  });

  it("places a left-side bubble a full width before the hole", () => {
    const { hole, bubble } = computeTourFrame(TARGET, "left", VP);
    expect(bubble.left).toBe(hole.x - BUBBLE_GAP - BUBBLE_WIDTH);
    expect(bubble.top).toBe(hole.y);
  });

  it("anchors a top-side bubble by its bottom edge", () => {
    const { hole, bubble } = computeTourFrame(TARGET, "top", VP);
    expect(bubble.bottom).toBe(VP.h - (hole.y - BUBBLE_GAP));
    expect(bubble.top).toBeUndefined();
  });

  it("flips to a side clear of the target when the preferred side would clamp onto it", () => {
    // The wizard's Finish button, bottom-right of a centred dialog on a narrow
    // viewport: a "right" bubble clamps back over it (the block bug). It must
    // flip to a side that leaves the control clickable.
    const vp: Viewport = { w: 1033, h: 800 };
    const finishBtn: Rect = { x: 724, y: 590, w: 82, h: 34 };
    const frame = computeTourFrame(finishBtn, "right", vp);
    expect(frame.side).toBe("left");
    // Bubble sits entirely left of the target hole — doesn't cover it.
    expect(frame.bubble.left + BUBBLE_WIDTH).toBeLessThanOrEqual(frame.hole.x);
  });

  it("clamps a bubble that would overflow the right edge back on screen", () => {
    // Target hard against the right edge: a right-side bubble would spill off.
    const rightEdge: Rect = { x: VP.w - 40, y: 300, w: 30, h: 30 };
    const { bubble } = computeTourFrame(rightEdge, "right", VP);
    expect(bubble.left).toBeLessThanOrEqual(VP.w - BUBBLE_WIDTH - 16);
    expect(bubble.left).toBeGreaterThanOrEqual(16);
  });
});
