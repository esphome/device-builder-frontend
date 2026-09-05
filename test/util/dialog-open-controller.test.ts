import { describe, expect, it, vi } from "vitest";
import { FakeHost } from "../_fake-host.js";
import { DialogOpenController } from "../../src/util/dialog-open-controller.js";

describe("DialogOpenController", () => {
  it("registers itself on the host and starts closed", () => {
    const host = new FakeHost();
    const ctrl = new DialogOpenController(host);
    expect(host.controllers).toContain(ctrl);
    expect(ctrl.open).toBe(false);
  });

  it("requests a host update when the flag changes", () => {
    const host = new FakeHost();
    const ctrl = new DialogOpenController(host);

    ctrl.open = true;
    expect(ctrl.open).toBe(true);
    expect(host.updates).toBe(1);

    ctrl.open = false;
    expect(ctrl.open).toBe(false);
    expect(host.updates).toBe(2);
  });

  it("does not request an update on a same-value write", () => {
    const host = new FakeHost();
    const ctrl = new DialogOpenController(host);

    ctrl.open = false;
    expect(host.updates).toBe(0);

    ctrl.open = true;
    ctrl.open = true;
    expect(host.updates).toBe(1);
  });

  // The close-animation race guard the copy-pasted host handlers used to
  // pin: the flag must flip on the initiating request-close, before
  // wa-dialog finishes hiding, so a host re-render can't re-assert ?open.
  it("onRequestClose flips the flag false", () => {
    const host = new FakeHost();
    const ctrl = new DialogOpenController(host);
    ctrl.open = true;

    ctrl.onRequestClose();
    expect(ctrl.open).toBe(false);
    expect(host.updates).toBe(2);
  });

  it("onRequestClose is a stable reference usable as an event listener", () => {
    const ctrl = new DialogOpenController(new FakeHost());
    const first = ctrl.onRequestClose;
    ctrl.open = true;
    expect(ctrl.onRequestClose).toBe(first);
  });

  it("requestClose flips the flag directly when no wrapper is mounted", () => {
    const host = new FakeHost();
    const ctrl = new DialogOpenController(host);
    ctrl.open = true;
    ctrl.requestClose();
    expect(ctrl.open).toBe(false);
  });

  it("requestClose defers to the mounted wrapper and leaves the flag to its handlers", () => {
    const host = new FakeHost();
    const wrapper = { requestClose: vi.fn() };
    (host as unknown as { shadowRoot: unknown }).shadowRoot = {
      querySelector: (sel: string) => (sel === "esphome-base-dialog" ? wrapper : null),
    };
    const ctrl = new DialogOpenController(host);
    ctrl.open = true;
    ctrl.requestClose();
    expect(wrapper.requestClose).toHaveBeenCalledTimes(1);
    expect(ctrl.open).toBe(true);
    ctrl.onAfterHide();
    expect(ctrl.open).toBe(false);
  });

  it("onAfterHide flips the flag false", () => {
    const host = new FakeHost();
    const ctrl = new DialogOpenController(host);
    ctrl.open = true;

    ctrl.onAfterHide();
    expect(ctrl.open).toBe(false);
    expect(host.updates).toBe(2);
  });

  it("onAfterHide after a request-close flip is a no-op", () => {
    const host = new FakeHost();
    const ctrl = new DialogOpenController(host);
    ctrl.open = true;

    ctrl.onRequestClose();
    ctrl.onAfterHide();
    expect(ctrl.open).toBe(false);
    expect(host.updates).toBe(2);
  });
});
