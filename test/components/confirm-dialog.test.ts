/**
 * @vitest-environment happy-dom
 *
 * Pins that Enter confirms a non-destructive confirm-dialog, never a destructive one.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeConfirmDialog } from "../../src/components/confirm-dialog.js";
import { baseDialogSettled, mount } from "../_dom.js";
import { pressEnter } from "../_press-enter.js";

describe("confirm-dialog ENTER", () => {
  it("confirms a non-destructive dialog on Enter", async () => {
    const el = await mount(new ESPHomeConfirmDialog());
    const onConfirm = vi.fn();
    el.addEventListener("confirm", onConfirm);
    el.open();
    await baseDialogSettled(el);
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not confirm a destructive dialog on Enter", async () => {
    const el = await mount(new ESPHomeConfirmDialog());
    el.destructive = true;
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("confirm", onConfirm);
    el.open();
    await baseDialogSettled(el);
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("fires confirm only once on a repeated Enter", async () => {
    const el = await mount(new ESPHomeConfirmDialog());
    const onConfirm = vi.fn();
    el.addEventListener("confirm", onConfirm);
    el.open();
    await baseDialogSettled(el);
    // Same-task repeat: the first Enter confirms and runs close(), but the
    // base detaches its listener asynchronously (in its next update), so
    // the second keydown still lands — only the _decided latch stops it.
    pressEnter();
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not confirm before the dialog is opened", async () => {
    const el = await mount(new ESPHomeConfirmDialog());
    const onConfirm = vi.fn();
    el.addEventListener("confirm", onConfirm);
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

// The migration onto esphome-base-dialog introduced the reactive ?open binding,
// the request-close handler, and the after-hide -> cancel path. Pin them so the
// dismiss-cancels contract can't silently regress.
describe("confirm-dialog dismiss / request-close", () => {
  const baseDialog = (el: ESPHomeConfirmDialog): HTMLElement =>
    el.shadowRoot!.querySelector("esphome-base-dialog")!;

  it("fires a single cancel when dismissed without a decision", async () => {
    const el = await mount(new ESPHomeConfirmDialog());
    el.open();
    await el.updateComplete;
    const onCancel = vi.fn();
    el.addEventListener("cancel", onCancel);
    baseDialog(el).dispatchEvent(new CustomEvent("after-hide"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not fire cancel when the dialog was confirmed", async () => {
    const el = await mount(new ESPHomeConfirmDialog());
    el.open();
    await baseDialogSettled(el);
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    el.addEventListener("confirm", onConfirm);
    el.addEventListener("cancel", onCancel);
    pressEnter(); // confirms (non-destructive) -> _decided = true
    baseDialog(el).dispatchEvent(new CustomEvent("after-hide"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("flips the reactive open flag to false on request-close", async () => {
    const el = await mount(new ESPHomeConfirmDialog());
    el.open();
    await el.updateComplete;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._dialog.open).toBe(true);
    baseDialog(el).dispatchEvent(new CustomEvent("request-close"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._dialog.open).toBe(false);
  });
});
