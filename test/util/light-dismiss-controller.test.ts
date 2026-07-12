/**
 * @vitest-environment happy-dom
 *
 * LightDismissController: outside-click + Escape dismissal for hand-rolled
 * popovers, active only while the host says so. The Escape half rides
 * EscapeController, whose capture option is pinned here too (its own suite
 * runs in plain Node, where event phases don't exist).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EscapeController } from "../../src/util/escape-controller.js";
import { LightDismissController } from "../../src/util/light-dismiss-controller.js";

type Host = import("lit").ReactiveControllerHost & HTMLElement;

function makeHost(): Host {
  const el = document.createElement("div");
  Object.assign(el, {
    addController: () => {},
    removeController: () => {},
    requestUpdate: () => {},
    updateComplete: Promise.resolve(true),
  });
  document.body.appendChild(el);
  return el as unknown as Host;
}

function clickOn(target: EventTarget) {
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
}

/* Controllers bind to document/window; an active one left behind would
   claim the next test's events (the Escape default preventDefaults, and
   EscapeController skips claimed events). Deactivate every controller
   made in the finished test. */
const active: Array<{ set(a: boolean): void }> = [];

function track<T extends { set(a: boolean): void }>(ctrl: T): T {
  active.push(ctrl);
  return ctrl;
}

afterEach(() => {
  for (const ctrl of active.splice(0)) ctrl.set(false);
  document.body.innerHTML = "";
});

describe("LightDismissController outside-click", () => {
  it("dismisses on a click outside the host, not inside it", () => {
    const host = makeHost();
    const inner = document.createElement("button");
    host.appendChild(inner);
    const onDismiss = vi.fn();
    const ctrl = track(new LightDismissController(host, onDismiss));
    ctrl.set(true);

    clickOn(inner);
    expect(onDismiss).not.toHaveBeenCalled();

    clickOn(document.body);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("uses the container callback as the inside boundary", () => {
    const host = makeHost();
    const wrap = document.createElement("div");
    const outsideWrap = document.createElement("div");
    host.appendChild(wrap);
    host.appendChild(outsideWrap);
    const onDismiss = vi.fn();
    const ctrl = track(
      new LightDismissController(host, onDismiss, { container: () => wrap })
    );
    ctrl.set(true);

    clickOn(wrap);
    expect(onDismiss).not.toHaveBeenCalled();

    // Inside the host but outside the container still dismisses.
    clickOn(outsideWrap);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("dismisses on any click when the container resolves to nothing", () => {
    const host = makeHost();
    const onDismiss = vi.fn();
    const ctrl = track(
      new LightDismissController(host, onDismiss, { container: () => null })
    );
    ctrl.set(true);

    clickOn(host);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("is inert until set(true) and after set(false) / hostDisconnected", () => {
    const host = makeHost();
    const onDismiss = vi.fn();
    const ctrl = track(new LightDismissController(host, onDismiss));

    clickOn(document.body);
    expect(onDismiss).not.toHaveBeenCalled();

    ctrl.set(true);
    ctrl.set(false);
    clickOn(document.body);
    expect(onDismiss).not.toHaveBeenCalled();

    ctrl.set(true);
    ctrl.hostDisconnected();
    clickOn(document.body);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("binds one listener across repeated set(true) calls", () => {
    const host = makeHost();
    const onDismiss = vi.fn();
    const ctrl = track(new LightDismissController(host, onDismiss));
    ctrl.set(true);
    ctrl.set(true);

    clickOn(document.body);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("LightDismissController Escape", () => {
  it("claims Escape and dismisses by default", () => {
    const host = makeHost();
    const onDismiss = vi.fn();
    const ctrl = track(new LightDismissController(host, onDismiss));
    ctrl.set(true);

    const esc = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(esc);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(esc.defaultPrevented).toBe(true);
  });

  it("runs the onEscape hook before dismissing", () => {
    const host = makeHost();
    const order: string[] = [];
    const onDismiss = vi.fn(() => order.push("dismiss"));
    const onEscape = vi.fn(() => order.push("hook"));
    const ctrl = track(new LightDismissController(host, onDismiss, { onEscape }));
    ctrl.set(true);

    const esc = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(esc);
    expect(order).toEqual(["hook", "dismiss"]);
    // The hook owns claiming; the controller adds no preventDefault of its own.
    expect(esc.defaultPrevented).toBe(false);
  });
});

describe("EscapeController capture option", () => {
  it("runs ahead of a stopPropagation deeper in the tree when capturing", () => {
    const child = document.createElement("div");
    document.body.appendChild(child);
    // A bubble-phase handler at the child swallows the event; only a
    // capture-phase document listener sees it first.
    child.addEventListener("keydown", (e) => e.stopPropagation());

    const seen: string[] = [];
    const host = makeHost();
    const capturing = track(
      new EscapeController(host, () => seen.push("capture"), {
        target: document,
        capture: true,
      })
    );
    const bubbling = track(
      new EscapeController(host, () => seen.push("bubble"), { target: document })
    );
    capturing.set(true);
    bubbling.set(true);

    child.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    );
    expect(seen).toEqual(["capture"]);
  });
});
