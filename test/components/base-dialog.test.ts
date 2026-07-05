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
