/**
 * @vitest-environment happy-dom
 */
import type { ReactiveControllerHost } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TourSkipAffordance } from "../../src/components/guided-tour/tour-skip-affordance.js";

const host = {
  addController() {},
  removeController() {},
  requestUpdate() {},
  updateComplete: Promise.resolve(true),
} as unknown as ReactiveControllerHost;

const rect = (left: number): DOMRect =>
  ({ left, right: left + 20, top: 10, bottom: 30, width: 20, height: 20 }) as DOMRect;

afterEach(() => {
  document.documentElement.style.cursor = "";
});

describe("TourSkipAffordance", () => {
  it("routes captured dialog clicks to Skip and Close for now separately", () => {
    const onSkip = vi.fn();
    const onPause = vi.fn();
    const controller = new TourSkipAffordance(host, {
      isDialogStep: () => true,
      skipRect: () => rect(10),
      pauseRect: () => rect(50),
      onSkip,
      onPause,
    });
    controller.setActive(true);

    window.dispatchEvent(
      new MouseEvent("click", { clientX: 15, clientY: 15, bubbles: true })
    );
    window.dispatchEvent(
      new MouseEvent("click", { clientX: 55, clientY: 15, bubbles: true })
    );

    expect(onSkip).toHaveBeenCalledOnce();
    expect(onPause).toHaveBeenCalledOnce();
    controller.setActive(false);
  });
});
