import { describe, expect, it } from "vitest";
import {
  BUBBLE_GAP,
  BUBBLE_WIDTH,
  SPOTLIGHT_PADDING,
  clamp,
  computeHole,
  computeTourFrame,
  unionRects,
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

describe("unionRects", () => {
  it("returns the bounding box of disjoint rects", () => {
    expect(
      unionRects([
        { x: 10, y: 20, w: 30, h: 40 },
        { x: 100, y: 5, w: 20, h: 10 },
      ])
    ).toEqual({ x: 10, y: 5, w: 110, h: 55 });
  });

  it("is the identity for a single rect", () => {
    expect(unionRects([TARGET])).toEqual(TARGET);
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
    // flip to a side that leaves the control clickable and stays on screen —
    // "left" would spill below the fold here, so it lands "top".
    const vp: Viewport = { w: 1033, h: 800 };
    const finishBtn: Rect = { x: 724, y: 590, w: 82, h: 34 };
    const frame = computeTourFrame(finishBtn, "right", vp);
    expect(frame.side).toBe("top");
    // Top-anchored bubble sits above the target hole — doesn't cover it.
    expect(vp.h - (frame.bubble.bottom ?? 0)).toBeLessThanOrEqual(frame.hole.y);
  });

  it("overlays the bubble on a near-full-screen hole instead of going off screen", () => {
    // A full-pane target (mobile editor pane): no side both clears the hole
    // and fits the viewport, so the bubble pins inside the viewport over it.
    const vp: Viewport = { w: 375, h: 812 };
    const pane: Rect = { x: 0, y: 72, w: 375, h: 630 };
    const frame = computeTourFrame(pane, "left", vp);
    expect(frame.overlay).toBe(true);
    expect(frame.bubble.top).toBeGreaterThanOrEqual(16);
    expect((frame.bubble.top ?? 0) + 220).toBeLessThanOrEqual(vp.h);
    expect(frame.bubble.left).toBeGreaterThanOrEqual(16);
    expect(frame.bubble.left + frame.bubble.width).toBeLessThanOrEqual(vp.w - 16);
  });

  it("prefers a viewport-fitting side over one that overflows it (mobile, target near top)", () => {
    // A dialog card near the top of a phone screen: "right"/"left" don't fit the
    // narrow width and "top" would overflow above the viewport, so the bubble
    // must drop to "bottom", which has room.
    const vp: Viewport = { w: 375, h: 812 };
    const card: Rect = { x: 16, y: 140, w: 343, h: 111 };
    const frame = computeTourFrame(card, "right", vp);
    expect(frame.side).toBe("bottom");
    expect(frame.bubble.top).toBeGreaterThanOrEqual(0);
  });

  it("clamps a bubble that would overflow the right edge back on screen", () => {
    // Target hard against the right edge: a right-side bubble would spill off.
    const rightEdge: Rect = { x: VP.w - 40, y: 300, w: 30, h: 30 };
    const { bubble } = computeTourFrame(rightEdge, "right", VP);
    expect(bubble.left).toBeLessThanOrEqual(VP.w - BUBBLE_WIDTH - 16);
    expect(bubble.left).toBeGreaterThanOrEqual(16);
  });
});
