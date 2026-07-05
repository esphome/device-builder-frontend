/**
 * @vitest-environment happy-dom
 *
 * Pins that the clone dialog confirms a valid new name on Enter via the
 * shared EnterController.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@home-assistant/webawesome/dist/components/dialog/dialog.js", () => ({}));

import { ESPHomeCloneDeviceDialog } from "../../src/components/clone-device-dialog.js";
import { mount } from "../_dom.js";
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

  it("keeps Enter reachable after close() until after-hide", async () => {
    // The empty/same/invalid checks are not idempotency guards (they pass
    // identically on the repeat); the listener detaches in _onAfterHide, not
    // close(), so the _resolved latch is the only thing stopping a second
    // dispatch while the dialog is still hiding.
    const el = await mount(new ESPHomeCloneDeviceDialog());
    el.open("source");
    await el.updateComplete;
    const onConfirm = vi.fn();
    el.addEventListener("clone-confirm", onConfirm as EventListener);
    const input = el.shadowRoot!.querySelector<HTMLInputElement>("#clone-new-name")!;
    input.value = "kitchen";
    input.dispatchEvent(new Event("input"));
    await el.updateComplete;
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
