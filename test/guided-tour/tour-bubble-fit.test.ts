/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactiveControllerHost } from "lit";

import { TourBubbleFit } from "../../src/components/guided-tour/tour-bubble-fit.js";
import {
  BUBBLE_WIDTH,
  type TourFrame,
} from "../../src/components/guided-tour/tour-geometry.js";

const HOST = {
  addController: () => {},
  removeController: () => {},
  requestUpdate: () => {},
  updateComplete: Promise.resolve(true),
} as unknown as ReactiveControllerHost;

function sideFrame(): TourFrame {
  return {
    hole: { x: 400, y: 300, w: 120, h: 40 },
    dim: {
      top: { x: 0, y: 0, w: 0, h: 0 },
      bottom: { x: 0, y: 0, w: 0, h: 0 },
      left: { x: 0, y: 0, w: 0, h: 0 },
      right: { x: 0, y: 0, w: 0, h: 0 },
    },
    bubble: { left: 536, top: 300, width: BUBBLE_WIDTH },
    side: "right",
  };
}

function dockedFrame(): TourFrame {
  return { ...sideFrame(), bubble: { left: 16, top: 16, width: 343 }, dock: "top" };
}

function fakeBubble(height: number, rect?: Partial<DOMRect>): HTMLElement {
  return {
    offsetHeight: height,
    getBoundingClientRect: () =>
      ({ left: 16, top: 16, width: 343, height, ...rect }) as DOMRect,
  } as HTMLElement;
}

function fakeAnchor(rect: Partial<DOMRect>): Element & { scrollIntoView: unknown } {
  return {
    getBoundingClientRect: () =>
      ({ left: 0, top: 0, width: 0, height: 0, ...rect }) as DOMRect,
    scrollIntoView: vi.fn(),
  } as unknown as Element & { scrollIntoView: unknown };
}

interface Harness {
  fit: TourBubbleFit;
  onHeightChange: ReturnType<typeof vi.fn>;
  set frame(f: TourFrame | null);
  set bubble(b: HTMLElement | undefined);
  set anchor(a: Element | null);
}

function makeFit(): Harness {
  let frame: TourFrame | null = null;
  let bubble: HTMLElement | undefined;
  let anchor: Element | null = null;
  const onHeightChange = vi.fn();
  const fit = new TourBubbleFit(HOST, {
    bubbleEl: () => bubble,
    frame: () => frame,
    anchorEl: () => anchor,
    isActionStep: () => true,
    onHeightChange,
  });
  return {
    fit,
    onHeightChange,
    set frame(f: TourFrame | null) {
      frame = f;
    },
    set bubble(b: HTMLElement | undefined) {
      bubble = b;
    },
    set anchor(a: Element | null) {
      anchor = a;
    },
  };
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
}

beforeEach(() => {
  setViewport(1280, 800);
});

describe("TourBubbleFit", () => {
  it("feeds the side bubble's measured height back exactly once per height", () => {
    const h = makeFit();
    h.frame = sideFrame();
    h.bubble = fakeBubble(420);
    h.fit.hostUpdated();
    expect(h.onHeightChange).toHaveBeenCalledTimes(1);
    expect(h.fit.measuredHeight).toBe(420);
    h.fit.hostUpdated();
    expect(h.onHeightChange).toHaveBeenCalledTimes(1);
  });

  it("never feeds a docked bubble's height back into placement", () => {
    const h = makeFit();
    h.frame = dockedFrame();
    h.bubble = fakeBubble(420);
    h.fit.hostUpdated();
    expect(h.onHeightChange).not.toHaveBeenCalled();
    expect(h.fit.measuredHeight).toBeUndefined();
  });

  it("nudges the anchor once when the bubble overlaps the hole", () => {
    const h = makeFit();
    const frame = dockedFrame();
    frame.hole = { x: 20, y: 100, w: 200, h: 60 };
    h.frame = frame;
    h.bubble = fakeBubble(300);
    const anchor = fakeAnchor({ left: 40, top: 120, width: 100, height: 30 });
    h.anchor = anchor;
    h.fit.hostUpdated();
    expect(anchor.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(anchor.scrollIntoView).toHaveBeenCalledWith({
      block: "end",
      inline: "nearest",
    });
    h.fit.hostUpdated();
    expect(anchor.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("does not scroll when the bubble clears the hole", () => {
    const h = makeFit();
    h.frame = dockedFrame();
    h.bubble = fakeBubble(200, { top: 584 });
    const anchor = fakeAnchor({ left: 40, top: 120, width: 100, height: 30 });
    h.anchor = anchor;
    h.fit.hostUpdated();
    expect(anchor.scrollIntoView).not.toHaveBeenCalled();
  });

  it("re-measures after the viewport changes", () => {
    const h = makeFit();
    h.frame = sideFrame();
    h.bubble = fakeBubble(420);
    h.fit.hostUpdated();
    h.fit.hostUpdated();
    expect(h.onHeightChange).toHaveBeenCalledTimes(1);
    setViewport(375, 667);
    h.bubble = fakeBubble(500);
    h.fit.hostUpdated();
    expect(h.onHeightChange).toHaveBeenCalledTimes(2);
    expect(h.fit.measuredHeight).toBe(500);
  });

  it("forgets the measurement and spent checks on reset", () => {
    const h = makeFit();
    h.frame = sideFrame();
    h.bubble = fakeBubble(420);
    h.fit.hostUpdated();
    expect(h.fit.measuredHeight).toBe(420);
    h.fit.reset();
    expect(h.fit.measuredHeight).toBeUndefined();
    h.fit.hostUpdated();
    expect(h.onHeightChange).toHaveBeenCalledTimes(2);
  });
});
