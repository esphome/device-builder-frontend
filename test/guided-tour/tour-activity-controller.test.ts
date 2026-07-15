/**
 * @vitest-environment happy-dom
 */
import type { ReactiveControllerHost } from "lit";
import { describe, expect, it, vi } from "vitest";
import { TourActivityController } from "../../src/components/guided-tour/tour-activity-controller.js";
import { setTourActive } from "../../src/components/guided-tour/tour-session.js";

describe("TourActivityController", () => {
  it("requests a render whenever tour activity changes", () => {
    const requestUpdate = vi.fn();
    const host = {
      addController() {},
      removeController() {},
      requestUpdate,
      updateComplete: Promise.resolve(true),
    } as unknown as ReactiveControllerHost;
    const controller = new TourActivityController(host);
    controller.hostConnected();

    setTourActive(true);
    setTourActive(false);

    expect(requestUpdate).toHaveBeenCalledTimes(2);
    controller.hostDisconnected();
  });
});
