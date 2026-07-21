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

export interface Bubble {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
}

export type Dock = "top" | "bottom";

export interface TourFrame {
  hole: Box;
  dim: { top: Box; bottom: Box; left: Box; right: Box };
  bubble: Bubble;
  side: Side;
  /** Set when no side both clears the hole and fits the viewport; the bubble
   *  is docked to this viewport edge instead and the caret is meaningless. */
  dock?: Dock;
}

export const SPOTLIGHT_PADDING = 10;
export const BUBBLE_WIDTH = 300;
export const BUBBLE_GAP = 16;
const EDGE_MARGIN = 16;
const BUBBLE_HEIGHT_EST = 220;
const COMPACT_BUBBLE_HEIGHT_EST = 340;
const DOCKED_MAX_WIDTH = 360;

const SIDE_ORDER: Record<Side, Side[]> = {
  right: ["right", "left", "top", "bottom"],
  left: ["left", "right", "top", "bottom"],
  top: ["top", "bottom", "right", "left"],
  bottom: ["bottom", "top", "left", "right"],
};

export function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(Math.max(lo, hi), value));
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** A DOMRect as the module's plain `Rect`. */
export function toRect(r: DOMRect): Rect {
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** The bounding box of one or more rects. */
export function unionRects(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y,
  };
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
  width: number,
  height: number
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
    top: clamp(top ?? 0, EDGE_MARGIN, vp.h - height - EDGE_MARGIN),
    width,
  };
}

/** The bubble's top edge in viewport coordinates. */
function bubbleTop(bubble: Bubble, vp: Viewport, height: number): number {
  return bubble.bottom !== undefined ? vp.h - bubble.bottom - height : (bubble.top ?? 0);
}

/** Long localized copy reaches ~310px on phones; desktop copy is much wider.
 *  Clamped to the bubble's CSS max-height (min(60vh, 100vh - 32px) in
 *  esphome-guided-tour.styles.ts) so the estimate never exceeds what a
 *  rendered bubble can be. */
function bubbleHeightEstimate(vp: Viewport): number {
  const base = vp.w <= 600 || vp.h <= 600 ? COMPACT_BUBBLE_HEIGHT_EST : BUBBLE_HEIGHT_EST;
  return Math.max(1, Math.min(base, vp.h * 0.6, vp.h - EDGE_MARGIN * 2));
}

function bubbleCoversHole(
  bubble: Bubble,
  vp: Viewport,
  hole: Box,
  height: number
): boolean {
  const top = bubbleTop(bubble, vp, height);
  return rectsIntersect({ x: bubble.left, y: top, w: bubble.width, h: height }, hole);
}

/** True when the bubble sits fully within the viewport's vertical margins
 *  (horizontal placement is already clamped in `computeBubble`). */
function bubbleFitsViewport(bubble: Bubble, vp: Viewport, height: number): boolean {
  const top = bubbleTop(bubble, vp, height);
  return top >= EDGE_MARGIN && top + height <= vp.h - EDGE_MARGIN;
}

/** Full-width-ish bubble pinned to the viewport edge farther from the hole. */
function computeDockedBubble(hole: Box, vp: Viewport): { bubble: Bubble; dock: Dock } {
  const w = Math.max(1, Math.min(vp.w - EDGE_MARGIN * 2, DOCKED_MAX_WIDTH));
  const left = (vp.w - w) / 2;
  const dock: Dock = hole.y + hole.h / 2 >= vp.h / 2 ? "top" : "bottom";
  return {
    bubble:
      dock === "top"
        ? { left, top: EDGE_MARGIN, width: w }
        : { left, bottom: EDGE_MARGIN, width: w },
    dock,
  };
}

export function computeTourFrame(
  rect: Rect,
  side: Side,
  vp: Viewport,
  options: { pad?: number; bubbleWidth?: number; bubbleHeight?: number } = {}
): TourFrame {
  const hole = computeHole(rect, options.pad);
  const width = options.bubbleWidth ?? BUBBLE_WIDTH;
  const height = options.bubbleHeight ?? bubbleHeightEstimate(vp);

  const candidates = SIDE_ORDER[side].map((candidate) => ({
    candidate,
    bubble: computeBubble(hole, candidate, vp, width, height),
  }));
  // Prefer a side that neither covers the hole nor overflows the viewport.
  const clear = candidates.filter(
    ({ bubble }) => !bubbleCoversHole(bubble, vp, hole, height)
  );
  const fitting = clear.find(({ bubble }) => bubbleFitsViewport(bubble, vp, height));
  const dim = computeDim(hole, vp);
  if (fitting) {
    return { hole, dim, bubble: fitting.bubble, side: fitting.candidate };
  }

  // No side both clears the hole and stays on screen (tall target on a small
  // viewport); dock the bubble to the edge whose half the hole occupies less,
  // keeping the spotlit control reachable instead of pinning over it.
  const docked = computeDockedBubble(hole, vp);
  // `side` is only read for caret placement, which docked frames skip.
  return { hole, dim, bubble: docked.bubble, side, dock: docked.dock };
}
