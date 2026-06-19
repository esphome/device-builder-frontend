import { describe, expect, it, vi } from "vitest";
import { SaveShortcutController } from "../../src/util/save-shortcut-controller.js";
import { FakeHost } from "../_fake-host.js";

/* Plain Node test env (no jsdom): feed the controller our own
   EventTarget and dispatch raw ``Event``s with the modifier/key props
   the handler reads. */
function makeKey(
  key: string,
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}
): Event {
  const e = new Event("keydown", { cancelable: true });
  Object.defineProperty(e, "key", { value: key });
  Object.defineProperty(e, "metaKey", { value: !!mods.meta });
  Object.defineProperty(e, "ctrlKey", { value: !!mods.ctrl });
  Object.defineProperty(e, "shiftKey", { value: !!mods.shift });
  Object.defineProperty(e, "altKey", { value: !!mods.alt });
  return e;
}

describe("SaveShortcutController", () => {
  it("invokes the callback on Cmd+S and Ctrl+S once connected, and calls preventDefault", () => {
    const target = new EventTarget();
    const host = new FakeHost();
    const cb = vi.fn();
    const ctrl = new SaveShortcutController(host, cb, { target });
    ctrl.hostConnected();

    const cmd = makeKey("s", { meta: true });
    target.dispatchEvent(cmd);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cmd.defaultPrevented).toBe(true);

    target.dispatchEvent(makeKey("s", { ctrl: true }));
    expect(cb).toHaveBeenCalledTimes(2);

    // Uppercase (Shift not pressed but caps/layout) still matches.
    target.dispatchEvent(makeKey("S", { meta: true }));
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("does not fire before the host is connected", () => {
    const target = new EventTarget();
    const cb = vi.fn();
    new SaveShortcutController(new FakeHost(), cb, { target });

    target.dispatchEvent(makeKey("s", { meta: true }));
    expect(cb).not.toHaveBeenCalled();
  });

  it("ignores Shift/Alt-modified Cmd+S, plain s, and other modified keys", () => {
    const target = new EventTarget();
    const cb = vi.fn();
    const ctrl = new SaveShortcutController(new FakeHost(), cb, { target });
    ctrl.hostConnected();

    target.dispatchEvent(makeKey("s", { meta: true, shift: true }));
    target.dispatchEvent(makeKey("s", { meta: true, alt: true }));
    target.dispatchEvent(makeKey("s", { ctrl: true, alt: true }));
    target.dispatchEvent(makeKey("s"));
    target.dispatchEvent(makeKey("k", { meta: true }));
    expect(cb).not.toHaveBeenCalled();
  });

  it("detaches on hostDisconnected", () => {
    const target = new EventTarget();
    const cb = vi.fn();
    const ctrl = new SaveShortcutController(new FakeHost(), cb, { target });
    ctrl.hostConnected();
    ctrl.hostDisconnected();

    target.dispatchEvent(makeKey("s", { meta: true }));
    expect(cb).not.toHaveBeenCalled();
  });

  it("skips when the event was already defaultPrevented", () => {
    const target = new EventTarget();
    const cb = vi.fn();
    const ctrl = new SaveShortcutController(new FakeHost(), cb, { target });
    ctrl.hostConnected();

    const e = makeKey("s", { meta: true });
    e.preventDefault();
    target.dispatchEvent(e);
    expect(cb).not.toHaveBeenCalled();
  });

  it("attaches only one listener for repeated hostConnected calls", () => {
    const target = new EventTarget();
    const cb = vi.fn();
    const ctrl = new SaveShortcutController(new FakeHost(), cb, { target });
    ctrl.hostConnected();
    ctrl.hostConnected();

    target.dispatchEvent(makeKey("s", { meta: true }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("auto-registers as a controller on the host", () => {
    const host = new FakeHost();
    const ctrl = new SaveShortcutController(host, () => {}, {
      target: new EventTarget(),
    });
    expect(host.controllers).toContain(ctrl);
  });
});
