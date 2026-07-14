/**
 * @vitest-environment happy-dom
 */
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import {
  TOUR_LAYOUT_CHANGE_EVENT,
  TOUR_LAYOUT_RESTORE_EVENT,
  TourLayoutController,
} from "../../src/components/guided-tour/tour-layout-controller.js";

let controller: ReactiveController | undefined;
const host = {
  addController(value: ReactiveController) {
    controller = value;
  },
  removeController() {},
  requestUpdate() {},
  updateComplete: Promise.resolve(true),
} as unknown as ReactiveControllerHost;

afterEach(() => {
  controller?.hostDisconnected?.();
  controller = undefined;
});

describe("TourLayoutController", () => {
  it("restores the layout that was active before the tour override", () => {
    let layout = "right";
    new TourLayoutController(
      host,
      () => layout,
      (value) => {
        layout = value;
      }
    );
    controller?.hostConnected?.();

    window.dispatchEvent(new CustomEvent(TOUR_LAYOUT_CHANGE_EVENT, { detail: "both" }));
    expect(layout).toBe("both");

    window.dispatchEvent(new Event(TOUR_LAYOUT_RESTORE_EVENT));
    expect(layout).toBe("right");
  });

  it("does not undo a layout the user explicitly selected during the tour", () => {
    let layout = "right";
    new TourLayoutController(
      host,
      () => layout,
      (value) => {
        layout = value;
      }
    );
    controller?.hostConnected?.();
    window.dispatchEvent(new CustomEvent(TOUR_LAYOUT_CHANGE_EVENT, { detail: "both" }));

    layout = "left";
    window.dispatchEvent(new Event("layout-change"));
    window.dispatchEvent(new Event(TOUR_LAYOUT_RESTORE_EVENT));

    expect(layout).toBe("left");
  });
});
