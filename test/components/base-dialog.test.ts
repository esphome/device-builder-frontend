// @vitest-environment happy-dom
//
// Pins the wrapper-owned Enter-to-confirm (issue #1269): a plain Enter fires
// confirmOnEnter only while open and only when a callback is set, inherits
// EnterController's focus-target skip rules, and detaches when open flips false.
import { describe, expect, it, vi } from "vitest";

// wa-dialog runs form-validation lifecycle hooks happy-dom doesn't implement;
// stub the import so the wrapper can render in the test.
vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { ESPHomeBaseDialog } from "../../src/components/base-dialog.js";
import { mount } from "../_dom.js";

// Dispatch a bubbling+composed Enter from `from`, which becomes
// composedPath()[0] (the element the controller treats as focused) and reaches
// the window listener the wrapper binds.
function pressEnter(from: Element): void {
  from.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      composed: true,
    })
  );
}

describe("esphome-base-dialog confirmOnEnter", () => {
  it("fires the callback on Enter while open", async () => {
    const confirmOnEnter = vi.fn();
    await mount(new ESPHomeBaseDialog(), { open: true, confirmOnEnter });
    pressEnter(document.body);
    expect(confirmOnEnter).toHaveBeenCalledTimes(1);
  });

  it("does not fire while closed", async () => {
    const confirmOnEnter = vi.fn();
    await mount(new ESPHomeBaseDialog(), { open: false, confirmOnEnter });
    pressEnter(document.body);
    expect(confirmOnEnter).not.toHaveBeenCalled();
  });

  it("does not fire when no callback is set", async () => {
    const el = await mount(new ESPHomeBaseDialog(), { open: true });
    // Nothing to assert beyond "no throw"; a stray listener would also leak
    // EnterController's preventDefault, so confirm the event isn't claimed.
    const ev = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(el.confirmOnEnter).toBeUndefined();
  });

  it("fires from a focused text input but not a button or select", async () => {
    const confirmOnEnter = vi.fn();
    await mount(new ESPHomeBaseDialog(), { open: true, confirmOnEnter });

    const input = document.createElement("input");
    const button = document.createElement("button");
    const select = document.createElement("select");
    document.body.append(input, button, select);

    pressEnter(input);
    expect(confirmOnEnter).toHaveBeenCalledTimes(1);

    pressEnter(button);
    pressEnter(select);
    expect(confirmOnEnter).toHaveBeenCalledTimes(1); // still 1 — both skipped
  });

  it("detaches the listener when open flips false", async () => {
    const confirmOnEnter = vi.fn();
    const el = await mount(new ESPHomeBaseDialog(), { open: true, confirmOnEnter });

    el.open = false;
    await el.updateComplete;

    pressEnter(document.body);
    expect(confirmOnEnter).not.toHaveBeenCalled();
  });
});

describe("esphome-base-dialog [autofocus]", () => {
  // The stubbed wa-dialog never animates, so fire the hook the real one
  // dispatches once fully shown.
  function fireAfterShow(el: ESPHomeBaseDialog): void {
    el.shadowRoot!.querySelector("wa-dialog")!.dispatchEvent(
      new CustomEvent("wa-after-show")
    );
  }

  it("focuses and selects the marked input after the dialog shows", async () => {
    const el = await mount(new ESPHomeBaseDialog());
    const input = document.createElement("input");
    input.setAttribute("autofocus", "");
    input.value = "prefilled";
    el.appendChild(input);
    el.open = true;
    await el.updateComplete;
    fireAfterShow(el);
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("prefilled".length);
  });

  it("does nothing without an [autofocus] child", async () => {
    const el = await mount(new ESPHomeBaseDialog());
    const input = document.createElement("input");
    el.appendChild(input);
    el.open = true;
    await el.updateComplete;
    fireAfterShow(el);
    expect(document.activeElement).not.toBe(input);
  });

  it("ignores a stray after-show while closed", async () => {
    const el = await mount(new ESPHomeBaseDialog());
    const input = document.createElement("input");
    input.setAttribute("autofocus", "");
    el.appendChild(input);
    await el.updateComplete;
    fireAfterShow(el);
    expect(document.activeElement).not.toBe(input);
  });

  it("ignores a nested dialog's after-show bubbling through the slot", async () => {
    const el = await mount(new ESPHomeBaseDialog());
    const input = document.createElement("input");
    input.setAttribute("autofocus", "");
    el.appendChild(input);
    // Stands in for a stacked inner wa-dialog living in slotted content;
    // its after-show bubbles up to the wrapper's own wa-dialog listener.
    const nested = document.createElement("div");
    el.appendChild(nested);
    el.open = true;
    await el.updateComplete;
    nested.dispatchEvent(new CustomEvent("wa-after-show", { bubbles: true }));
    expect(document.activeElement).not.toBe(input);
  });

  it("focuses a non-text input without attempting select()", async () => {
    const el = await mount(new ESPHomeBaseDialog());
    const input = document.createElement("input");
    input.type = "number";
    input.setAttribute("autofocus", "");
    el.appendChild(input);
    el.open = true;
    await el.updateComplete;
    fireAfterShow(el); // must not throw (select() is illegal on number)
    expect(document.activeElement).toBe(input);
  });
});
