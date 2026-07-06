/**
 * @vitest-environment happy-dom
 *
 * Pins the unsaved-changes prompt's behaviour after the migration onto
 * esphome-base-dialog: Enter takes the primary "Save and leave" path (never
 * Discard), the save latch fires once, and the reactive ?open /
 * request-close / after-hide -> cancel contract holds (the page-leave guard
 * depends on a definitive answer for every dismiss path).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));
vi.mock("@home-assistant/webawesome/dist/components/icon/icon.js", () => ({}));

import { ESPHomeUnsavedChangesDialog } from "../../src/components/unsaved-changes-dialog.js";
import { mount } from "../_dom.js";
import { pressEnter } from "../_press-enter.js";

const baseDialog = (el: ESPHomeUnsavedChangesDialog): HTMLElement =>
  el.shadowRoot!.querySelector("esphome-base-dialog")!;

describe("unsaved-changes-dialog ENTER", () => {
  it("saves and leaves on Enter (never discards)", async () => {
    const el = await mount(new ESPHomeUnsavedChangesDialog());
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    el.addEventListener("save", onSave);
    el.addEventListener("discard", onDiscard);
    el.open();
    pressEnter();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("fires save only once on a repeated Enter", async () => {
    const el = await mount(new ESPHomeUnsavedChangesDialog());
    const onSave = vi.fn();
    el.addEventListener("save", onSave);
    el.open();
    pressEnter();
    pressEnter();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does not save before the dialog is opened", async () => {
    const el = await mount(new ESPHomeUnsavedChangesDialog());
    const onSave = vi.fn();
    el.addEventListener("save", onSave);
    pressEnter();
    expect(onSave).not.toHaveBeenCalled();
  });
});

// The migration onto esphome-base-dialog introduced the reactive ?open binding,
// the request-close handler, and the after-hide -> cancel path. Pin them so the
// dismiss-cancels contract can't silently regress.
describe("unsaved-changes-dialog dismiss / request-close", () => {
  it("fires a single cancel when dismissed without a decision", async () => {
    const el = await mount(new ESPHomeUnsavedChangesDialog());
    el.open();
    await el.updateComplete;
    const onCancel = vi.fn();
    el.addEventListener("cancel", onCancel);
    baseDialog(el).dispatchEvent(new CustomEvent("after-hide"));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not fire cancel after a decision (save)", async () => {
    const el = await mount(new ESPHomeUnsavedChangesDialog());
    el.open();
    await el.updateComplete;
    const onSave = vi.fn();
    const onCancel = vi.fn();
    el.addEventListener("save", onSave);
    el.addEventListener("cancel", onCancel);
    pressEnter(); // saves -> _resolved = true
    baseDialog(el).dispatchEvent(new CustomEvent("after-hide"));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("flips the reactive open flag to false on request-close", async () => {
    const el = await mount(new ESPHomeUnsavedChangesDialog());
    el.open();
    await el.updateComplete;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._dialog.open).toBe(true);
    baseDialog(el).dispatchEvent(new CustomEvent("request-close"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((el as any)._dialog.open).toBe(false);
  });
});
