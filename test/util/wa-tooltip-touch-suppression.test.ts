/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { installWaTooltipTouchSuppression } from "../../src/util/wa-tooltip-touch-suppression.js";

function mockHoverNone(matches: boolean): void {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches } as MediaQueryList));
}

function dispatchWaShow(tagName: string): Event {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const el = document.createElement(tagName);
  host.attachShadow({ mode: "open" }).appendChild(el);
  const event = new Event("wa-show", {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  el.dispatchEvent(event);
  host.remove();
  return event;
}

describe("installWaTooltipTouchSuppression", () => {
  beforeAll(() => {
    installWaTooltipTouchSuppression();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("cancels a tooltip show on a hover-incapable device", () => {
    mockHoverNone(true);
    expect(dispatchWaShow("wa-tooltip").defaultPrevented).toBe(true);
  });

  it("lets a tooltip show on a hover-capable device", () => {
    mockHoverNone(false);
    expect(dispatchWaShow("wa-tooltip").defaultPrevented).toBe(false);
  });

  it("never cancels another component's wa-show", () => {
    mockHoverNone(true);
    expect(dispatchWaShow("wa-dialog").defaultPrevented).toBe(false);
  });

  it("registers a single listener even when installed repeatedly", () => {
    installWaTooltipTouchSuppression();
    installWaTooltipTouchSuppression();
    mockHoverNone(true);
    expect(dispatchWaShow("wa-tooltip").defaultPrevented).toBe(true);
    expect(window.matchMedia).toHaveBeenCalledTimes(1);
  });

  it("lets the show through when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(dispatchWaShow("wa-tooltip").defaultPrevented).toBe(false);
  });
});
