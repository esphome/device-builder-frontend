import type { ReactiveController, ReactiveControllerHost } from "lit";
import { BUBBLE_WIDTH, rectsIntersect, toRect, type TourFrame } from "./tour-geometry.js";

export interface TourBubbleFitOptions {
  /** The rendered bubble element (undefined until the frame first paints). */
  bubbleEl: () => HTMLElement | undefined;
  /** The frame the bubble was placed from (null while inactive/unanchored). */
  frame: () => TourFrame | null;
  /** The step's measured anchor — the control the user must reach. */
  anchorEl: () => Element | null;
  isActionStep: () => boolean;
  /** Re-place the bubble with the newly measured height. */
  onHeightChange: () => void;
}

/**
 * Feed the bubble's real rendered height back into placement, then nudge
 * the anchor clear of it.
 *
 * Placement runs before the bubble paints, so `computeTourFrame` starts from
 * a height estimate; long localized copy on a phone can double it, letting
 * an accepted placement cover the very control the step points at. After a
 * step's first paint this measures the side-placement bubble and asks the
 * host to re-place once with the real height (a docked bubble renders at a
 * different width, so its height never feeds back into side placement). Once
 * settled, if the bubble still overlaps the spotlight hole, the anchor is
 * scrolled toward the free half of the viewport — one check per placement
 * per step, so a scroll-triggered re-measure can't loop and steady-state
 * renders skip the layout reads entirely.
 */
export class TourBubbleFit implements ReactiveController {
  private _sideHeight?: number;
  private _checkedPlacements = new Set<string>();

  constructor(
    host: ReactiveControllerHost,
    private readonly _options: TourBubbleFitOptions
  ) {
    host.addController(this);
  }

  /** The measured side-placement bubble height, if any (else the caller's
   *  estimate stands). */
  get measuredHeight(): number | undefined {
    return this._sideHeight;
  }

  /** Forget the measurement and checked placements; call on step change. */
  reset(): void {
    this._sideHeight = undefined;
    this._checkedPlacements.clear();
  }

  hostUpdated(): void {
    const frame = this._options.frame();
    const bubble = this._options.bubbleEl();
    if (!frame || !bubble) return;
    const sideBubble = frame.bubble.width === BUBBLE_WIDTH;
    const placement = frame.dock ?? frame.side;
    if (
      this._checkedPlacements.has(placement) &&
      (!sideBubble || this._sideHeight !== undefined)
    ) {
      return;
    }
    const height = bubble.offsetHeight;
    if (height === 0) return;
    if (
      sideBubble &&
      (this._sideHeight === undefined || Math.abs(this._sideHeight - height) > 1)
    ) {
      this._sideHeight = height;
      this._options.onHeightChange();
      return;
    }
    this._checkedPlacements.add(placement);
    this._maybeNudgeAnchor(frame, bubble);
  }

  private _maybeNudgeAnchor(frame: TourFrame, bubble: HTMLElement): void {
    if (!this._options.isActionStep()) return;
    const anchor = this._options.anchorEl();
    if (!anchor || typeof anchor.scrollIntoView !== "function") return;
    const bubbleRect = bubble.getBoundingClientRect();
    if (!rectsIntersect(toRect(bubbleRect), frame.hole)) return;
    const bubbleOnTop = bubbleRect.top + bubbleRect.height / 2 < window.innerHeight / 2;
    anchor.scrollIntoView({
      block: bubbleOnTop ? "end" : "start",
      inline: "nearest",
    });
  }
}
