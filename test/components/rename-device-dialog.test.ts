/**
 * @vitest-environment happy-dom
 *
 * Pins that the rename dialog confirms a valid new name on Enter (via
 * base-dialog's confirmOnEnter), and ignores Enter when unchanged or after
 * close.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { ESPHomeRenameDeviceDialog } from "../../src/components/rename-device-dialog.js";
import { baseDialogSettled, mount } from "../_dom.js";
import { pressEnter } from "../_press-enter.js";

function setValue(el: ESPHomeRenameDeviceDialog, value: string): Promise<unknown> {
  const input = el.shadowRoot!.querySelector("input")!;
  input.value = value;
  input.dispatchEvent(new Event("input"));
  return el.updateComplete;
}

describe("rename-device-dialog ENTER", () => {
  it("confirms a valid new name on Enter", async () => {
    const el = await mount(new ESPHomeRenameDeviceDialog());
    el.open("oldname");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("rename-confirm", onConfirm as EventListener);
    await setValue(el, "kitchen");
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((onConfirm.mock.calls[0][0] as CustomEvent).detail).toBe("kitchen");
  });

  it("ignores Enter when the name is unchanged", async () => {
    const el = await mount(new ESPHomeRenameDeviceDialog());
    el.open("kitchen");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("rename-confirm", onConfirm as EventListener);
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("fires rename-confirm only once on a repeated Enter", async () => {
    const el = await mount(new ESPHomeRenameDeviceDialog());
    el.open("oldname");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("rename-confirm", onConfirm as EventListener);
    await setValue(el, "kitchen");
    pressEnter();
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("stops a same-task Enter repeat via the one-shot latch", async () => {
    // The unchanged/invalid checks are not idempotency guards (they pass
    // identically on the repeat). base-dialog detaches its Enter listener
    // in its own update after close() flips ?open — asynchronously — so an
    // Enter landing in the same task as the confirm still finds the
    // listener bound; the _resolved latch is what stops a second dispatch.
    const el = await mount(new ESPHomeRenameDeviceDialog());
    el.open("oldname");
    await baseDialogSettled(el);
    const onConfirm = vi.fn();
    el.addEventListener("rename-confirm", onConfirm as EventListener);
    await setValue(el, "kitchen");
    pressEnter(); // confirms and runs close(); the detaching update is queued
    expect((el as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(false);
    pressEnter(); // same task: listener still bound; stopped only by the latch
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await baseDialogSettled(el); // base-dialog's willUpdate unbinds the listener
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("ignores Enter after close() settles", async () => {
    const el = await mount(new ESPHomeRenameDeviceDialog());
    el.open("oldname");
    await baseDialogSettled(el);
    await setValue(el, "kitchen");
    el.close();
    await baseDialogSettled(el); // detaches the Enter listener
    const onConfirm = vi.fn();
    el.addEventListener("rename-confirm", onConfirm as EventListener);
    pressEnter();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

/**
 * Regression coverage for the esphome-base-dialog migration (#549).
 *
 * The migration swapped the imperative ``dialog.open`` for a reactive
 * open flag (now owned by DialogOpenController), so the open/close
 * contract is the part most likely to silently regress.
 * esphome-base-dialog never mutates its own ``open`` on a user close, so
 * the host's controller must flip the flag in ``onRequestClose``
 * (Escape / X / backdrop) — otherwise a re-render would re-assert ``?open``
 * and the dialog could never dismiss.
 */
describe("rename-device-dialog base-dialog open contract", () => {
  it("open() / close() drive the reactive open flag", async () => {
    const el = await mount(new ESPHomeRenameDeviceDialog());
    const view = el as unknown as { _dialog: { open: boolean } };
    el.open("oldname");
    expect(view._dialog.open).toBe(true);
    el.close();
    expect(view._dialog.open).toBe(false);
  });

  it("the controller's onRequestClose flips the reactive open flag", async () => {
    const el = await mount(new ESPHomeRenameDeviceDialog());
    const view = el as unknown as {
      _dialog: { open: boolean; onRequestClose: () => void };
    };
    el.open("oldname");
    expect(view._dialog.open).toBe(true);
    view._dialog.onRequestClose();
    expect(view._dialog.open).toBe(false);
  });
});
