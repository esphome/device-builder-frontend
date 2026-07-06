export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "top" | "bottom" | "left" | "right";

export interface Viewport {
  w: number;
  h: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Ring extends Box {
  radius: number;
}

export interface Bubble {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
}

export interface TourFrame {
  hole: Box;
  ring: Ring;
  dim: { top: Box; bottom: Box; left: Box; right: Box };
  bubble: Bubble;
  side: Side;
}

export const SPOTLIGHT_PADDING = 6;
export const BUBBLE_WIDTH = 300;
export const BUBBLE_GAP = 16;
const RING_MAX_RADIUS = 14;
const EDGE_MARGIN = 16;
const BUBBLE_BOTTOM_RESERVE = 200;
const BUBBLE_HEIGHT_EST = 220;

const SIDE_ORDER: Record<Side, Side[]> = {
  right: ["right", "left", "top", "bottom"],
  left: ["left", "right", "top", "bottom"],
  top: ["top", "bottom", "right", "left"],
  bottom: ["bottom", "top", "left", "right"],
};

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(Math.max(lo, hi), value));
}

/** The padded spotlight box around the target rect. */
export function computeHole(rect: Rect, pad = SPOTLIGHT_PADDING): Box {
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    w: rect.w + pad * 2,
    h: rect.h + pad * 2,
  };
}

function computeDim(hole: Box, vp: Viewport): TourFrame["dim"] {
  const right = hole.x + hole.w;
  const bottom = hole.y + hole.h;
  return {
    top: { x: 0, y: 0, w: vp.w, h: Math.max(hole.y, 0) },
    bottom: { x: 0, y: bottom, w: vp.w, h: Math.max(vp.h - bottom, 0) },
    left: { x: 0, y: hole.y, w: Math.max(hole.x, 0), h: hole.h },
    right: { x: right, y: hole.y, w: Math.max(vp.w - right, 0), h: hole.h },
  };
}

function computeBubble(
  hole: Box,
  side: Side,
  vp: Viewport,
  width = BUBBLE_WIDTH
): Bubble {
  const right = hole.x + hole.w;
  let left: number;
  let top: number | undefined;
  let bottom: number | undefined;
  switch (side) {
    case "right":
      left = right + BUBBLE_GAP;
      top = hole.y;
      break;
    case "left":
      left = hole.x - BUBBLE_GAP - width;
      top = hole.y;
      break;
    case "bottom":
      left = hole.x;
      top = hole.y + hole.h + BUBBLE_GAP;
      break;
    case "top":
      left = hole.x;
      bottom = vp.h - (hole.y - BUBBLE_GAP);
      break;
  }
  left = clamp(left, EDGE_MARGIN, vp.w - width - EDGE_MARGIN);
  if (bottom !== undefined) {
    return { left, bottom: clamp(bottom, EDGE_MARGIN, vp.h - EDGE_MARGIN), width };
  }
  return {
    left,
    top: clamp(top ?? 0, EDGE_MARGIN, vp.h - BUBBLE_BOTTOM_RESERVE),
    width,
  };
}

function bubbleCoversHole(bubble: Bubble, vp: Viewport, hole: Box): boolean {
  const top =
    bubble.bottom !== undefined
      ? vp.h - bubble.bottom - BUBBLE_HEIGHT_EST
      : (bubble.top ?? 0);
  const b = {
    l: bubble.left,
    r: bubble.left + bubble.width,
    t: top,
    b: top + BUBBLE_HEIGHT_EST,
  };
  return !(
    b.r <= hole.x ||
    b.l >= hole.x + hole.w ||
    b.b <= hole.y ||
    b.t >= hole.y + hole.h
  );
}

export function computeTourFrame(
  rect: Rect,
  side: Side,
  vp: Viewport,
  options: { pad?: number; bubbleWidth?: number } = {}
): TourFrame {
  const hole = computeHole(rect, options.pad);
  const ring: Ring = { ...hole, radius: Math.min(hole.h / 2, RING_MAX_RADIUS) };
  const width = options.bubbleWidth;

  let chosenSide = side;
  let bubble = computeBubble(hole, side, vp, width);
  for (const candidate of SIDE_ORDER[side]) {
    const b = computeBubble(hole, candidate, vp, width);
    if (!bubbleCoversHole(b, vp, hole)) {
      chosenSide = candidate;
      bubble = b;
      break;
    }
  }
  return { hole, ring, dim: computeDim(hole, vp), bubble, side: chosenSide };
}
