/**
 * @vitest-environment happy-dom
 *
 * Pins the toast clearance publisher: measured from the target's top edge
 * to the viewport bottom, re-measured on resize, cleared when the target is
 * gone or the host leaves.
 */

import { afterEach, describe, expect, it } from "vitest";

import { FakeHost } from "../_fake-host.js";
import {
  TOAST_CLEARANCE_PROPERTY,
  ToastClearanceController,
} from "../../src/util/toast-clearance-controller.js";

const clearance = () =>
  document.documentElement.style.getPropertyValue(TOAST_CLEARANCE_PROPERTY);

/** Element whose top edge sits `fromBottom()` px above the viewport bottom. */
const targetAt = (fromBottom: () => number): HTMLElement => {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ top: window.innerHeight - fromBottom() }) as DOMRect;
  return el;
};

describe("ToastClearanceController", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(TOAST_CLEARANCE_PROPERTY);
  });

  it("publishes the target clearance and follows window resizes", () => {
    let fromBottom = 40;
    const target = targetAt(() => fromBottom);
    const ctrl = new ToastClearanceController(new FakeHost(), () => target);
    ctrl.hostConnected();
    ctrl.hostUpdated();
    expect(clearance()).toBe("40px");
    fromBottom = 64;
    window.dispatchEvent(new Event("resize"));
    expect(clearance()).toBe("64px");
    ctrl.hostDisconnected();
  });

  it("clears the property when the target is missing or the host disconnects", () => {
    let target: HTMLElement | null = null;
    const ctrl = new ToastClearanceController(new FakeHost(), () => target);
    ctrl.hostConnected();
    ctrl.hostUpdated();
    expect(clearance()).toBe("");
    target = targetAt(() => 40);
    ctrl.hostUpdated();
    expect(clearance()).toBe("40px");
    target = null;
    ctrl.hostUpdated();
    expect(clearance()).toBe("");
    target = targetAt(() => 40);
    ctrl.hostUpdated();
    expect(clearance()).toBe("40px");
    ctrl.hostDisconnected();
    expect(clearance()).toBe("");
  });
});
