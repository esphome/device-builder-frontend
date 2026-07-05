/**
 * @vitest-environment happy-dom
 *
 * Pins that the rename dialog confirms a valid new name on Enter (via the
 * shared EnterController), and ignores Enter when unchanged or after close.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { ESPHomeRenameDeviceDialog } from "../../src/components/rename-device-dialog.js";
import { mount } from "../_dom.js";
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

  it("keeps Enter reachable after close() until after-hide", async () => {
    // The unchanged/invalid checks are not idempotency guards (they pass
    // identically on the repeat); the listener detaches in _onAfterHide, not
    // close(), so the _resolved latch is the only thing stopping a second
    // dispatch while the dialog is still hiding.
    const el = await mount(new ESPHomeRenameDeviceDialog());
    el.open("oldname");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("rename-confirm", onConfirm as EventListener);
    await setValue(el, "kitchen");
    pressEnter(); // confirms and runs close(), but after-hide hasn't fired
    // close() flips the reactive open flag; the base-dialog is still hiding
    // (after-hide not yet fired) so the EnterController listener stays bound.
    expect((el as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(false);
    pressEnter(); // listener still bound; stopped only by the latch
    expect(onConfirm).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onAfterHide(); // unbinds the listener
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("ignores Enter after the dialog hides", async () => {
    const el = await mount(new ESPHomeRenameDeviceDialog());
    el.open("oldname");
    await setValue(el, "kitchen");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (el as any)._onAfterHide(); // wa-dialog close path
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
