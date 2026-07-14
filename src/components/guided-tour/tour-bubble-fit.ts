import type { ReactiveController, ReactiveControllerHost } from "lit";
import {
  BUBBLE_WIDTH,
  rectsIntersect,
  type Rect,
  type TourFrame,
} from "./tour-geometry.js";

export interface TourBubbleFitOptions {
  /** The rendered bubble element (undefined until the frame first paints). */
  bubbleEl: () => HTMLElement | undefined;
  /** The frame the bubble was placed from (null while inactive/unanchored). */
  frame: () => TourFrame | null;
  /** The step's measured anchor — the control the user must reach. */
  anchorEl: () => Element | null;
  stepIndex: () => number;
  isActionStep: () => boolean;
  /** Re-place the bubble with the newly measured height. */
  onHeightChange: () => void;
}

/**
 * Feed the bubble's real rendered height back into placement, then nudge
 * the anchor clear of it.
 *
 * Placement runs before the bubble paints, so `computeTourFrame` starts from
 * a height estimate; long localized copy on a phone can double it, letting an
 * accepted placement cover the very control the step points at. After each
 * render this measures the bubble (memoized per bubble width so a docked
 * re-layout never feeds back into side placement) and asks the host to
 * re-place once per height change. Once the height is settled, if the bubble
 * still overlaps the action anchor, the anchor is scrolled toward the free
 * half of the viewport — once per placement per step, so a scroll-triggered
 * re-measure can't loop.
 */
export class TourBubbleFit implements ReactiveController {
  private _heights = new Map<number, number>();
  private _spentNudges = new Set<string>();

  constructor(
    host: ReactiveControllerHost,
    private readonly _options: TourBubbleFitOptions
  ) {
    host.addController(this);
  }

  /** The measured side-placement bubble height, if any (else the caller's
   *  estimate stands). */
  get measuredHeight(): number | undefined {
    return this._heights.get(BUBBLE_WIDTH);
  }

  /** Forget measurements and spent nudges; call on step change. */
  reset(): void {
    this._heights.clear();
    this._spentNudges.clear();
  }

  hostUpdated(): void {
    const frame = this._options.frame();
    const bubble = this._options.bubbleEl();
    if (!frame || !bubble) return;
    const height = bubble.offsetHeight;
    if (height === 0) return;
    const width = frame.bubble.width;
    const prev = this._heights.get(width);
    if (prev === undefined || Math.abs(prev - height) > 1) {
      this._heights.set(width, height);
      if (width === BUBBLE_WIDTH) {
        this._options.onHeightChange();
        return;
      }
    }
    this._maybeNudgeAnchor(frame, bubble);
  }

  private _maybeNudgeAnchor(frame: TourFrame, bubble: HTMLElement): void {
    if (!this._options.isActionStep()) return;
    const key = `${this._options.stepIndex()}:${frame.dock ?? frame.side}`;
    if (this._spentNudges.has(key)) return;
    const anchor = this._options.anchorEl();
    if (!anchor || typeof anchor.scrollIntoView !== "function") return;
    const b = bubble.getBoundingClientRect();
    if (!rectsIntersect(toRect(b), toRect(anchor.getBoundingClientRect()))) return;
    this._spentNudges.add(key);
    const bubbleOnTop = b.top + b.height / 2 < window.innerHeight / 2;
    anchor.scrollIntoView({
      block: bubbleOnTop ? "end" : "start",
      inline: "nearest",
    });
  }
}

function toRect(r: DOMRect): Rect {
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}
