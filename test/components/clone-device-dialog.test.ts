/**
 * @vitest-environment happy-dom
 *
 * Pins that the clone dialog confirms a valid new name on Enter via
 * base-dialog's confirmOnEnter.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { ESPHomeCloneDeviceDialog } from "../../src/components/clone-device-dialog.js";
import { baseDialogSettled, mount } from "../_dom.js";
import { pressEnter } from "../_press-enter.js";

describe("clone-device-dialog ENTER", () => {
  it("confirms a valid new name on Enter", async () => {
    const el = await mount(new ESPHomeCloneDeviceDialog());
    el.open("source");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
    const input = el.shadowRoot!.querySelector<HTMLInputElement>("#clone-new-name")!;
    input.value = "kitchen";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect((onConfirm.mock.calls[0][0] as CustomEvent).detail.newName).toBe("kitchen");
  });

  it("fires clone-confirm only once on a repeated Enter", async () => {
    const el = await mount(new ESPHomeCloneDeviceDialog());
    el.open("source");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
    const input = el.shadowRoot!.querySelector<HTMLInputElement>("#clone-new-name")!;
    input.value = "kitchen";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    pressEnter();
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("stops a same-task Enter repeat via the one-shot latch", async () => {
    // The empty/same/invalid checks are not idempotency guards (they pass
    // identically on the repeat). base-dialog detaches its Enter listener
    // in its own update after close() flips ?open — asynchronously — so an
    // Enter landing in the same task as the confirm still finds the
    // listener bound; the _resolved latch is what stops a second dispatch.
    const el = await mount(new ESPHomeCloneDeviceDialog());
    el.open("source");
    await baseDialogSettled(el);
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
    const input = el.shadowRoot!.querySelector<HTMLInputElement>("#clone-new-name")!;
    input.value = "kitchen";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
    pressEnter(); // confirms and runs close(); the detaching update is queued
    expect((el as unknown as { _dialog: { open: boolean } })._dialog.open).toBe(false);
    pressEnter(); // same task: listener still bound; stopped only by the latch
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await baseDialogSettled(el); // base-dialog's willUpdate unbinds the listener
    pressEnter();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("ignores Enter with an empty name", async () => {
    const el = await mount(new ESPHomeCloneDeviceDialog());
    el.open("source");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
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
describe("clone-device-dialog base-dialog open contract", () => {
  it("open() / close() drive the reactive open flag", async () => {
    const el = await mount(new ESPHomeCloneDeviceDialog());
    const view = el as unknown as { _dialog: { open: boolean } };
    el.open("source");
    expect(view._dialog.open).toBe(true);
    el.close();
    expect(view._dialog.open).toBe(false);
  });

  it("the controller's onRequestClose flips the reactive open flag", async () => {
    const el = await mount(new ESPHomeCloneDeviceDialog());
    const view = el as unknown as {
      _dialog: { open: boolean; onRequestClose: () => void };
    };
    el.open("source");
    expect(view._dialog.open).toBe(true);
    view._dialog.onRequestClose();
    expect(view._dialog.open).toBe(false);
  });
});
