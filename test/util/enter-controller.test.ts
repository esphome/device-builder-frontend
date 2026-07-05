/**
 * @vitest-environment happy-dom
 *
 * Pins EnterController: fires on a plain Enter, stays out of the way for
 * modifiers, IME, already-handled events, and self-handling focus targets.
 */
import type { ReactiveControllerHost } from "lit";
import { describe, expect, it, vi } from "vitest";
import { EnterController } from "../../src/util/enter-controller.js";

const stubHost = { addController() {} } as unknown as ReactiveControllerHost;

let target: HTMLElement;

function setup(onEnter = vi.fn()) {
  target = document.createElement("div");
  document.body.appendChild(target);
  const controller = new EnterController(stubHost, onEnter, { target });
  controller.set(true);
  return { controller, onEnter };
}

// Dispatch a keydown that bubbles up to `target`'s listener; `from` becomes
// composedPath()[0], i.e. the element the controller treats as focused.
function press(
  from: Element,
  init: KeyboardEventInit = {},
  prevent = false
): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", {
    key: "Enter",
    bubbles: true,
    cancelable: true,
    composed: true,
    ...init,
  });
  if (prevent) ev.preventDefault();
  from.dispatchEvent(ev);
  return ev;
}

describe("EnterController", () => {
  it("fires on a plain Enter from a neutral element", () => {
    const { onEnter } = setup();
    press(target);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it("fires on Enter from a text input", () => {
    const { onEnter } = setup();
    const input = document.createElement("input");
    target.appendChild(input);
    press(input);
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it.each(["button", "a", "textarea", "select"])(
    "ignores Enter when focus is on a <%s>",
    (tag) => {
      const { onEnter } = setup();
      const el = document.createElement(tag);
      target.appendChild(el);
      press(el);
      expect(onEnter).not.toHaveBeenCalled();
    }
  );

  it("ignores Enter in a contenteditable region", () => {
    const { onEnter } = setup();
    const el = document.createElement("div");
    el.contentEditable = "true";
    target.appendChild(el);
    press(el);
    expect(onEnter).not.toHaveBeenCalled();
  });

  it.each([
    ["ctrlKey", { ctrlKey: true }],
    ["metaKey", { metaKey: true }],
    ["altKey", { altKey: true }],
    ["shiftKey", { shiftKey: true }],
    ["isComposing", { isComposing: true }],
  ])("ignores Enter with %s", (_label, init) => {
    const { onEnter } = setup();
    press(target, init as KeyboardEventInit);
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("ignores a non-Enter key", () => {
    const { onEnter } = setup();
    press(target, { key: "a" });
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("ignores an already-defaultPrevented Enter", () => {
    const { onEnter } = setup();
    press(target, {}, true);
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("stops firing after set(false)", () => {
    const { controller, onEnter } = setup();
    controller.set(false);
    press(target);
    expect(onEnter).not.toHaveBeenCalled();
  });

  it("only the first active controller acts on a shared Enter (stacked modals)", () => {
    target = document.createElement("div");
    document.body.appendChild(target);
    const first = vi.fn();
    const second = vi.fn();
    new EnterController(stubHost, first, { target }).set(true);
    new EnterController(stubHost, second, { target }).set(true);
    press(target);
    // The first to act calls preventDefault; the second bails on its guard.
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
