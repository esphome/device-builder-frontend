import { describe, expect, it, vi } from "vitest";
import type { ReactiveController, ReactiveControllerHost } from "lit";
import { EscapeController } from "../../src/util/escape-controller.js";

class FakeHost implements ReactiveControllerHost {
  controllers: ReactiveController[] = [];
  addController(c: ReactiveController) {
    this.controllers.push(c);
  }
  removeController() {}
  requestUpdate() {}
  updateComplete = Promise.resolve(true);
}

/* The runtime test environment is plain Node (no jsdom), so we feed
   the controller our own EventTarget and dispatch raw ``Event``s with
   a ``key`` property tacked on — KeyboardEvent isn't available
   without a DOM polyfill, but the controller only reads ``key`` and
   ``defaultPrevented``. */
function makeEsc(): Event {
  const e = new Event("keydown", { cancelable: true });
  Object.defineProperty(e, "key", { value: "Escape" });
  return e;
}

function makeKey(key: string): Event {
  const e = new Event("keydown", { cancelable: true });
  Object.defineProperty(e, "key", { value: key });
  return e;
}

describe("EscapeController", () => {
  it("invokes the callback when active and ignores it when not", () => {
    const target = new EventTarget();
    const host = new FakeHost();
    const cb = vi.fn();
    const ctrl = new EscapeController(host, cb, { target });

    target.dispatchEvent(makeEsc());
    expect(cb).not.toHaveBeenCalled();

    ctrl.set(true);
    target.dispatchEvent(makeEsc());
    expect(cb).toHaveBeenCalledTimes(1);

    ctrl.set(false);
    target.dispatchEvent(makeEsc());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("only attaches one listener for repeated set(true) calls", () => {
    const target = new EventTarget();
    const host = new FakeHost();
    const cb = vi.fn();
    const ctrl = new EscapeController(host, cb, { target });

    ctrl.set(true);
    ctrl.set(true);
    ctrl.set(true);
    target.dispatchEvent(makeEsc());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("ignores keys other than Escape", () => {
    const target = new EventTarget();
    const host = new FakeHost();
    const cb = vi.fn();
    const ctrl = new EscapeController(host, cb, { target });
    ctrl.set(true);

    target.dispatchEvent(makeKey("Enter"));
    target.dispatchEvent(makeKey("a"));
    expect(cb).not.toHaveBeenCalled();

    target.dispatchEvent(makeEsc());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("skips when the event was already defaultPrevented", () => {
    const target = new EventTarget();
    const host = new FakeHost();
    const cb = vi.fn();
    const ctrl = new EscapeController(host, cb, { target });
    ctrl.set(true);

    const e = makeEsc();
    e.preventDefault();
    target.dispatchEvent(e);
    expect(cb).not.toHaveBeenCalled();
  });

  it("hostDisconnected detaches even if still active", () => {
    const target = new EventTarget();
    const host = new FakeHost();
    const cb = vi.fn();
    const ctrl = new EscapeController(host, cb, { target });
    ctrl.set(true);

    ctrl.hostDisconnected();
    target.dispatchEvent(makeEsc());
    expect(cb).not.toHaveBeenCalled();
  });

  it("passes the event to the callback", () => {
    const target = new EventTarget();
    const host = new FakeHost();
    let received: Event | null = null;
    const ctrl = new EscapeController(
      host,
      (e) => {
        received = e;
        e.preventDefault();
      },
      { target }
    );
    ctrl.set(true);

    const e = makeEsc();
    target.dispatchEvent(e);
    expect(received).toBe(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it("auto-registers as a controller on the host", () => {
    const target = new EventTarget();
    const host = new FakeHost();
    const ctrl = new EscapeController(host, () => {}, { target });
    expect(host.controllers).toContain(ctrl);
  });
});
