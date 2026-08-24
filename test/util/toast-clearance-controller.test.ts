/**
 * @vitest-environment happy-dom
 *
 * Pins the toast clearance publisher: measured from the target's top edge
 * to the viewport bottom, re-measured on resize, cleared when the target is
 * gone or the host leaves, and same-target host updates coalesce to a frame.
 */

import { afterEach, describe, expect, it } from "vitest";

import { FakeHost } from "../_fake-host.js";
import {
  TOAST_CLEARANCE_PROPERTY,
  ToastClearanceController,
} from "../../src/util/toast-clearance-controller.js";

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

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

  it("publishes the target clearance and follows window resizes", async () => {
    let fromBottom = 40;
    const target = targetAt(() => fromBottom);
    const ctrl = new ToastClearanceController(new FakeHost(), () => target);
    ctrl.hostConnected();
    expect(clearance()).toBe("40px");
    fromBottom = 64;
    window.dispatchEvent(new Event("resize"));
    expect(clearance()).toBe("64px");
    fromBottom = 48;
    ctrl.hostUpdated();
    ctrl.hostUpdated();
    expect(clearance()).toBe("64px");
    await nextFrame();
    expect(clearance()).toBe("48px");
    ctrl.hostDisconnected();
    expect(clearance()).toBe("");
    ctrl.hostConnected();
    expect(clearance()).toBe("48px");
    ctrl.hostDisconnected();
  });

  it("falls back to the default offset for a hidden target", () => {
    const target = document.createElement("div");
    target.getBoundingClientRect = () => ({ top: 0, width: 0, height: 0 }) as DOMRect;
    const ctrl = new ToastClearanceController(new FakeHost(), () => target);
    ctrl.hostConnected();
    expect(clearance()).toBe("");
    ctrl.hostDisconnected();
  });

  it("clamps a target above the viewport to the viewport height", () => {
    const target = targetAt(() => window.innerHeight + 500);
    const ctrl = new ToastClearanceController(new FakeHost(), () => target);
    ctrl.hostConnected();
    expect(clearance()).toBe(`${window.innerHeight}px`);
    ctrl.hostDisconnected();
  });

  it("restores the property if another writer cleared it", async () => {
    const target = targetAt(() => 40);
    const ctrl = new ToastClearanceController(new FakeHost(), () => target);
    ctrl.hostConnected();
    document.documentElement.style.removeProperty(TOAST_CLEARANCE_PROPERTY);
    ctrl.hostUpdated();
    await nextFrame();
    expect(clearance()).toBe("40px");
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
